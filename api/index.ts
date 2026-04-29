import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from '../server/config/db';
import authRoutes from '../server/routes/authRoutes';
import profileRoutes from '../server/routes/profileRoutes';
import commentRoutes from '../server/routes/commentRoutes';
import leaderboardRoutes from '../server/routes/leaderboardRoutes';
import watchProgressRoutes from '../server/routes/watchProgressRoutes';
import rewardRoutes from '../server/routes/rewardRoutes';
import notificationRoutes from '../server/routes/notificationRoutes';
import recommendationRoutes from '../server/routes/recommendationRoutes';
import searchRoutes from '../server/routes/searchRoutes';
import listRoutes from '../server/routes/listRoutes';
import trendingRoutes from '../server/routes/trendingRoutes';

const app = express();
app.use(cors({ origin: (_o, cb) => cb(null, true), methods: ['GET','POST','PUT','DELETE','OPTIONS'], credentials: true }));
app.use(express.json({ limit: '100kb' }));

let dbReady = false;
app.use(async (_req, _res, next) => {
  if (!dbReady) { try { await connectDB(); dbReady = true; } catch (e) { console.error('[DB]', e); } }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/progress', watchProgressRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/lists', listRoutes);
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'AniWave', ts: Date.now() }));

// ─── AniList GraphQL Proxy ────────────────────────────────────────────────────
// All AniList requests go through this proxy so the browser never hits
// graphql.anilist.co directly. This avoids:
//   1. Cloudflare IP blocks on shared hosting IPs
//   2. Rate limit spikes from many users sharing the same browser IP
//   3. Intermittent CORS issues on some networks
// Server-side Node.js has a stable IP and respects proper rate limits.
app.post('/api/anilist', async (req: express.Request, res: express.Response) => {
  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AniWave/2.0 (https://aniwave.fun)',
      },
      body: JSON.stringify(req.body),
    });

    let data: Record<string, unknown>;
    try {
      data = await response.json() as Record<string, unknown>;
    } catch {
      res.status(502).json({ errors: [{ message: 'AniList returned invalid JSON', status: 502 }] });
      return;
    }

    // Pass through AniList rate limit headers so client can react
    const rl = response.headers.get('X-RateLimit-Remaining');
    const rlReset = response.headers.get('X-RateLimit-Reset');
    if (rl) res.setHeader('X-RateLimit-Remaining', rl);
    if (rlReset) res.setHeader('X-RateLimit-Reset', rlReset);

    // Cache successful responses for 5 minutes on Vercel CDN edge
    if (response.ok && data?.data) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    }

    res.status(response.status).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AniList proxy error';
    console.error('[AniList proxy]', msg);
    res.status(502).json({ errors: [{ message: msg, status: 502 }] });
  }
});

// ─── Kiwi (miruro AnimePahe) Proxy ───────────────────────────────────────────
// Proxies miruro-nine-navy.vercel.app to avoid CORS and rate limits
// URL format: /api/kiwi/{anilistId}/{audio}/{episodeId}
// Mapped to: https://miruro-nine-navy.vercel.app/watch/kiwi/{anilistId}/{audio}/{episodeId}
// episodeId is typically: animepahe-{episodeNumber}
app.get('/api/kiwi/:anilistId/:audio/:episodeId', async (req: express.Request, res: express.Response) => {
  const { anilistId, audio, episodeId } = req.params;
  try {
    const url = `https://miruro-nine-navy.vercel.app/watch/kiwi/${anilistId}/${audio}/${episodeId}`;
    console.log('[Kiwi proxy] Fetching:', url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; AniWave/2.0)',
          'Origin': 'https://miruro.tv',
          'Referer': 'https://miruro.tv/',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json() as Record<string, unknown>;
    } catch {
      console.error('[Kiwi proxy] Non-JSON response from miruro, status:', response.status);
      res.status(502).json({ error: 'Kiwi server returned non-JSON response', streams: [], download: null });
      return;
    }

    if (response.ok && data?.streams) {
      res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=360');
    }

    res.status(response.status).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Kiwi proxy error';
    console.error('[Kiwi proxy]', msg);
    if (msg.includes('abort')) {
      res.status(504).json({ error: 'Kiwi server timed out', streams: [], download: null });
    } else {
      res.status(502).json({ error: msg, streams: [], download: null });
    }
  }
});
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ message: err instanceof Error ? err.message : 'Error' });
});
export default app;
