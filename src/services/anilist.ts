/**
 * AniList GraphQL API Service
 * Primary source for all anime data.
 * AniList ID is used as the streaming ID for all embed URLs.
 */

// Primary: our server-side proxy (avoids Cloudflare blocks, rate limits, CORS)
// Fallback: direct AniList endpoint (used if proxy is unavailable)
const ANILIST_PROXY = '/api/anilist';
const ANILIST_DIRECT = 'https://graphql.anilist.co';

export const FALLBACK_IMAGE = 'https://placehold.co/300x400/0f0f1a/6366f1?text=No+Image';
export const FALLBACK_BANNER = 'https://placehold.co/1280x400/0f0f1a/6366f1?text=AnimeVault';

// ─── Embed URL builders ──────────────────────────────────────────────────────
export type AudioType = 'sub' | 'dub';

export interface StreamServer {
  id: string;
  name: string;
  getUrl: (anilistId: string | number, episode: number, audio: AudioType) => string;
}

// ─── Kiwi (AnimePahe via miruro API) stream types ───────────────────────────
export interface KiwiStream {
  url: string;
  type: 'hls' | 'embed';
  quality: string;
  audio: string;
  fansub: string;
  isActive: boolean;
  referer: string;
}

export interface KiwiStreamData {
  streams: KiwiStream[];
  download: string | null;
}

/**
 * Fetch Kiwi (AnimePahe) streams from the miruro API.
 * Endpoint: https://miruro-nine-navy.vercel.app/watch/kiwi/{anilistId}/{audio}/animepahe-{episode}
 * Returns embed URLs (kwik.cx) + hls URLs + a download link.
 * NOTE: HLS (owocdn.top) URLs are Cloudflare-protected and will be blocked in browser.
 *       We use the kwik.cx EMBED URLs instead — they play fine in an iframe.
 */
export async function fetchKiwiStreams(
  anilistId: string | number,
  episode: number,
  audio: 'sub' | 'dub',
): Promise<KiwiStreamData> {
  // Direct fetch to miruro API — bypasses fetchWithRetry so its AniList-specific
  // error handling (which throws on HTTP 500) doesn't interfere with Kiwi responses.
  // URL: https://miruro-nine-navy.vercel.app/watch/kiwi/{anilistId}/{audio}/animepahe-{episode}
  const miruroUrl = `https://miruro-nine-navy.vercel.app/watch/kiwi/${anilistId}/${audio}/animepahe-${episode}`;

  let json: any;
  let lastErr = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(miruroUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response (status ${res.status}): ${text.slice(0, 120)}`);
      }

      // Got valid JSON — break regardless of HTTP status
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt < 3) await sleep(800 * attempt);
    }
  }

  if (!json) throw new Error(`Kiwi failed after 3 attempts: ${lastErr}`);
  if (json?.error) throw new Error(String(json.error));
  if (!json?.streams?.length) throw new Error('No streams available for this episode on AnimePahe.');

  // Extract only embed (kwik.cx) and hls streams
  const streams: KiwiStream[] = json.streams.map((s: any) => ({
    url: String(s?.url || ''),
    type: (s?.type === 'hls' ? 'hls' : 'embed') as 'hls' | 'embed',
    quality: String(s?.quality || '720p'),
    audio: String(s?.audio || audio),
    fansub: String(s?.fansub || ''),
    isActive: Boolean(s?.isActive),
    referer: String(s?.referer || 'https://kwik.cx/'),
  }));

  return {
    streams,
    download: json?.download || null,
  };
}

export const STREAM_SERVERS: StreamServer[] = [
  {
    id: 'fast',
    name: 'Fast',
    getUrl: (id, ep, audio) => `https://megaplay.buzz/stream/ani/${id}/${ep}/${audio}`,
  },
  {
    id: 'vidnest',
    name: 'VidNest',
    getUrl: (id, ep, audio) => `https://vidnest.fun/animepahe/${id}/${ep}/${audio}`,
  },
  {
    id: 'anime4up',
    name: 'Server 3',
    getUrl: (id, ep, audio) => `https://player.anime4up.tv/?id=${id}&ep=${ep}&type=${audio}`,
  },
  // Kiwi is handled separately in Watch.tsx (uses fetchKiwiStreams + kwik embed)
];

// ─── Retry + Rate-limit helper ───────────────────────────────────────────────

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on transient failures.
 *
 * Retried:  network errors, HTTP 429 (rate limit), HTTP 500/502/503/504
 * NOT retried: HTTP 400 (bad query), 401, 403, 404, GraphQL-level errors
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (networkError) {
      if (attempt > maxRetries) {
        throw new Error(
          `Network error after ${maxRetries} retries: ${(networkError as Error).message}`,
        );
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
      continue;
    }

    if (response.ok) return response;

    // Rate-limited
    if (response.status === 429) {
      if (attempt > maxRetries) {
        throw new Error('AniList rate limit exceeded. Please wait a moment and try again.');
      }
      const retryAfter = response.headers.get('Retry-After');
      const rateLimitReset = response.headers.get('X-RateLimit-Reset');
      let waitMs: number;
      if (retryAfter) {
        waitMs = parseInt(retryAfter, 10) * 1000;
      } else if (rateLimitReset) {
        waitMs = Math.max(0, parseInt(rateLimitReset, 10) * 1000 - Date.now());
      } else {
        waitMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
      }
      await sleep(waitMs);
      continue;
    }

    // Transient server errors
    if ([500, 502, 503, 504].includes(response.status)) {
      if (attempt > maxRetries) {
        throw new Error(`AniList server error (${response.status}) after ${maxRetries} retries.`);
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
      continue;
    }

    // Non-retryable (4xx except 429) — return so caller can read the error body
    // For 404 (episode not found on AnimePahe) this allows a graceful error message
    return response;
  }
}

// ─── GraphQL query helper ────────────────────────────────────────────────────
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = JSON.stringify({ query, variables });
  const reqInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  };

  // Try our server-side proxy first (avoids CORS + Cloudflare blocks)
  let res: Response;
  let usedProxy = true;
  try {
    res = await fetchWithRetry(ANILIST_PROXY, reqInit, 2);
    // If proxy returned a gateway error, fall through to direct
    if (!res.ok && [502, 503, 504].includes(res.status)) {
      throw new Error();
    }
  } catch {
    // Proxy unavailable or errored — fall back to direct AniList
    usedProxy = false;
    res = await fetchWithRetry(ANILIST_DIRECT, reqInit, 3);
  }
  void usedProxy; // suppress unused warning

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error('AniList returned invalid JSON. Please try again.');
  }

  if (json?.errors?.length) {
    const err = json.errors[0];
    throw new Error(err?.message || 'AniList GraphQL error');
  }
  if (!json?.data) {
    throw new Error('AniList returned no data. Please try again.');
  }
  return json.data as T;
}

// ─── Sequential queue to avoid burst rate-limiting ──────────────────────────
// Promise.all() fires all requests at once. Under slow connections or at the
// start of a session this can push you over AniList's 90 req/min limit.
async function sequential<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  for (const fn of fns) {
    results.push(await fn());
    await sleep(80); // reduced gap - 80ms is safe for 90req/min
  }
  return results;
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface AnimeTitle {
  romaji: string;
  english: string | null;
  native: string | null;
}

export interface AnimeTag {
  name: string;
  rank: number;
  isMediaSpoiler: boolean;
}

export interface AnimeStudio {
  id: number;
  name: string;
  isAnimationStudio: boolean;
}

export interface AnimeCharacter {
  id: number;
  name: { full: string };
  image: { medium: string };
  role: string;
}

export interface AnimeStaff {
  id: number;
  name: { full: string };
  image: { medium: string };
  primaryOccupations: string[];
}

export interface AnimeTrailer {
  id: string;
  site: string;
}

export interface AnimeRelation {
  id: number;
  title: AnimeTitle;
  coverImage: { large: string; medium: string };
  type: string;
  format: string;
  status: string;
}

export interface AnilistAnime {
  id: number;
  title: AnimeTitle;
  description: string | null;
  coverImage: { extraLarge: string; large: string; medium: string; color: string | null };
  bannerImage: string | null;
  genres: string[];
  tags: AnimeTag[];
  averageScore: number | null;
  popularity: number;
  favourites: number;
  episodes: number | null;
  duration: number | null;
  status: string;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  endDate: { year: number | null; month: number | null; day: number | null };
  format: string;
  source: string | null;
  countryOfOrigin: string | null;
  isAdult: boolean;
  trailer: AnimeTrailer | null;
  studios: { nodes: AnimeStudio[] };
  characters: { edges: { node: AnimeCharacter; role: string }[] };
  staff: { edges: { node: AnimeStaff; role: string }[] };
  relations: { edges: { node: AnimeRelation; relationType: string }[] };
  recommendations: { nodes: { mediaRecommendation: AnilistAnime | null }[] };
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  synonyms: string[];
  streamingEpisodes: { title: string; thumbnail: string; url: string }[];
}

// Normalized card type used everywhere in the UI
export interface AnimeCard {
  id: number;
  title: string;
  image: string;
  rating: string;
  episodes: string;
  status: string;
  format: string;
  year: string;
  genres: string[];
  color: string | null;
}

function normalizeCard(a: AnilistAnime): AnimeCard {
  return {
    id: a.id,
    title: a.title.english || a.title.romaji || a.title.native || 'Unknown',
    image: a.coverImage?.extraLarge || a.coverImage?.large || a.coverImage?.medium || FALLBACK_IMAGE,
    rating: a.averageScore ? `${a.averageScore}%` : '?',
    episodes: a.episodes ? `${a.episodes} EP` : '?',
    status: a.status || '',
    format: a.format || '',
    year: a.seasonYear ? String(a.seasonYear) : (a.startDate?.year ? String(a.startDate.year) : ''),
    genres: a.genres?.slice(0, 3) || [],
    color: a.coverImage?.color || null,
  };
}

// ─── Fragments ──────────────────────────────────────────────────────────────
const CARD_FRAGMENT = `
  id
  title { romaji english native }
  coverImage { extraLarge large medium color }
  averageScore
  popularity
  episodes
  status
  format
  seasonYear
  startDate { year month day }
  genres
`;

const FULL_FRAGMENT = `
  id
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large medium color }
  bannerImage
  genres
  tags { name rank isMediaSpoiler }
  averageScore
  popularity
  favourites
  episodes
  duration
  status
  season
  seasonYear
  startDate { year month day }
  endDate { year month day }
  format
  source
  countryOfOrigin
  isAdult
  trailer { id site }
  synonyms
  studios(isMain: true) { nodes { id name isAnimationStudio } }
  characters(sort: ROLE, perPage: 12) {
    edges { role node { id name { full } image { medium } } }
  }
  staff(perPage: 8) {
    edges { role node { id name { full } image { medium } } }
  }
  relations {
    edges {
      relationType
      node {
        id title { romaji english } coverImage { large medium }
        type format status
      }
    }
  }
  recommendations(perPage: 8) {
    nodes {
      mediaRecommendation {
        id title { romaji english } coverImage { extraLarge large }
        averageScore episodes format seasonYear
      }
    }
  }
  nextAiringEpisode { episode airingAt }
  streamingEpisodes { title thumbnail url }
`;

// ─── API Functions ────────────────────────────────────────────────────────────

export async function getTrending(page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getPopular(page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME, isAdult: false, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getTopRated(page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME, isAdult: false, minimumTagRank: 60, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getSeasonalAnime(page = 1, perPage = 20): Promise<AnimeCard[]> {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL';
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(season: $season, seasonYear: $year, sort: POPULARITY_DESC, type: ANIME, isAdult: false, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { season, year, page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getMovies(page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(format: MOVIE, sort: POPULARITY_DESC, type: ANIME, isAdult: false, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getByGenre(genre: string, page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($genre: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(genre: $genre, sort: POPULARITY_DESC, type: ANIME, isAdult: false, status_not_in: [NOT_YET_RELEASED, CANCELLED]) { ${CARD_FRAGMENT} }
      }
    }
  `, { genre, page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function searchAnime(query: string, page = 1, perPage = 20): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, sort: SEARCH_MATCH, type: ANIME, isAdult: false) { ${CARD_FRAGMENT} }
      }
    }
  `, { search: query, page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getAnimeDetails(id: number | string): Promise<AnilistAnime> {
  const data = await gql<{ Media: AnilistAnime }>(`
    query($id: Int) {
      Media(id: $id, type: ANIME) { ${FULL_FRAGMENT} }
    }
  `, { id: Number(id) });
  return data.Media;
}

/**
 * FIX: Previously used Promise.all() which fired 4 simultaneous requests.
 * Under rate limits or slow connections this caused intermittent failures.
 * Now fetches sequentially with a 150 ms gap to stay within AniList rate limits.
 */
export async function getHomeData() {
  const [trending, popular, topRated, seasonal] = await sequential([
    () => getTrending(1, 15),
    () => getPopular(1, 15),
    () => getTopRated(1, 15),
    () => getSeasonalAnime(1, 15),
  ]);
  return { trending, popular, topRated, seasonal };
}

export const ANIME_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy',
  'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
  'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

// Format helpers
export function formatStatus(status: string): string {
  const map: Record<string, string> = {
    FINISHED: 'Finished', RELEASING: 'Airing', NOT_YET_RELEASED: 'Upcoming',
    CANCELLED: 'Cancelled', HIATUS: 'Hiatus',
  };
  return map[status] || status;
}

export function formatFormat(format: string): string {
  const map: Record<string, string> = {
    TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special',
    OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music',
  };
  return map[format] || format;
}

export function formatDate(d: { year: number | null; month: number | null; day: number | null }): string {
  if (!d?.year) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.month ? `${months[d.month - 1]} ${d.day || ''}, ${d.year}`.trim() : String(d.year);
}

export function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").trim();
}

// ─── Additional home page queries ────────────────────────────────────────────

export async function getAiringAnime(page = 1, perPage = 12): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(status: RELEASING, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export async function getUpcoming(page = 1, perPage = 12): Promise<AnimeCard[]> {
  const data = await gql<{ Page: { media: AnilistAnime[] } }>(`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${CARD_FRAGMENT} }
      }
    }
  `, { page, perPage });
  return data.Page.media.map(normalizeCard);
}

export interface ScheduleItem {
  id: number;
  title: string;
  image: string;
  episode: number;
  airingAt: number; // unix timestamp
  dayLabel: string; // 'Monday', 'Tuesday', etc.
}

export async function getWeeklySchedule(): Promise<ScheduleItem[]> {
  const now = Math.floor(Date.now() / 1000);
  const weekEnd = now + 7 * 24 * 3600;
  const data = await gql<{ Page: { airingSchedules: any[] } }>(`
    query($from: Int, $to: Int) {
      Page(perPage: 50) {
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          episode
          airingAt
          media {
            id
            title { english romaji }
            coverImage { large color }
            status
            type
            isAdult
          }
        }
      }
    }
  `, { from: now, to: weekEnd });

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return (data.Page.airingSchedules || [])
    .filter((s: any) => s.media?.type === 'ANIME' && !s.media?.isAdult)
    .map((s: any) => ({
      id: s.media.id,
      title: s.media.title.english || s.media.title.romaji || '',
      image: s.media.coverImage?.large || FALLBACK_IMAGE,
      episode: s.episode,
      airingAt: s.airingAt,
      dayLabel: DAYS[new Date(s.airingAt * 1000).getDay()],
    }));
}
