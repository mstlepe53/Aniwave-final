/**
 * Watch Page – AniWave
 * - Miruro-style Sub/Dub dropdown + Server dropdown (pill selectors)
 * - Kiwi server (AnimePahe via miruro API) as 1st option in server dropdown
 *   Uses kwik.cx embed URLs (HLS owocdn.top URLs are Cloudflare-blocked in browsers)
 * - Download button shown when Kiwi server is active (uses pahe.win link from API)
 * - Episode list in sidebar (right col), comments below anime info card
 * - All other functionality preserved exactly
 */
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, SkipForward, SkipBack, Flag, Share2,
  Heart, Bookmark, List, Eye, Search, AlertCircle, Info,
  ChevronRight, Timer, Download, ChevronDown, Mic, Zap,
} from 'lucide-react';
import { useAnimeDetails } from '../hooks/useAnimeQueries';
import {
  FALLBACK_IMAGE, STREAM_SERVERS, AudioType, stripHtml,
  fetchKiwiStreams, KiwiStreamData,
} from '../services/anilist';
import { useAuth } from '../context/AuthContext';
import { useList } from '../hooks/useList';
import SEOHead from '../components/SEOHead';
import Toast from '../components/Toast';
import CommentSection from '../components/comments/CommentSection';

const WATCH_HISTORY_KEY = 'animevault_history';

const GENRE_COLORS = [
  { bg: '#ef4444', text: '#fff' }, { bg: '#f97316', text: '#fff' },
  { bg: '#eab308', text: '#000' }, { bg: '#22c55e', text: '#fff' },
  { bg: '#06b6d4', text: '#fff' }, { bg: '#3b82f6', text: '#fff' },
  { bg: '#8b5cf6', text: '#fff' }, { bg: '#ec4899', text: '#fff' },
  { bg: '#14b8a6', text: '#fff' }, { bg: '#f59e0b', text: '#000' },
];

const SERVERS = [
  { id: 'kiwi', name: 'kiwi' },
  ...STREAM_SERVERS,
];

function addToHistory(item: { title: string; image: string; url: string; subtitle?: string }) {
  try {
    const h = JSON.parse(localStorage.getItem(WATCH_HISTORY_KEY) || '[]');
    const f = h.filter((x: any) => x.url !== item.url);
    f.unshift(item);
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(f.slice(0, 20)));
    window.dispatchEvent(new Event('storage'));
  } catch {}
}

function getSecondsUntilAiring(airingAt: number): number {
  return Math.max(0, airingAt - Math.floor(Date.now() / 1000));
}

function formatCountdown(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return 'soon';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Miruro-style dropdown pill ──────────────────────────────────────────────
interface DropdownOption { label: string; value: string; icon?: React.ReactNode; badge?: string }

function DropdownPill({
  icon, value, options, onChange,
}: {
  icon: React.ReactNode;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-w-[110px] justify-between"
      >
        <span className="flex items-center gap-2">{icon}{selected.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 min-w-[170px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left
                ${opt.value === value
                  ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
              <span className="flex items-center gap-2">
                {opt.icon && opt.icon}
                {opt.label}
              </span>
              <span className="flex items-center gap-2">
                {opt.badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
                    {opt.badge}
                  </span>
                )}
                {opt.value === value && (
                  <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Episode Panel (reused for both mobile inline + desktop sidebar) ──────────
interface EpisodePanelProps {
  loading: boolean;
  totalEps: number;
  epFilter: string;
  setEpFilter: (v: string) => void;
  epView: 'list' | 'grid';
  setEpView: (v: (prev: 'list' | 'grid') => 'list' | 'grid') => void;
  filteredEps: number[];
  episode: number;
  id: string;
  anime: any;
  posterImg: string;
  audio: string;
  title: string;
}

function EpisodePanel({
  loading, totalEps, epFilter, setEpFilter, epView, setEpView,
  filteredEps, episode, id, anime, posterImg, audio, title,
}: EpisodePanelProps) {
  return (
    <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex flex-wrap gap-2 items-center">
        <span className="text-sm font-bold dark:text-white shrink-0">
          {loading ? '…' : `Episodes (${totalEps || '?'})`}
        </span>
        <div className="relative flex-1 min-w-[120px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Filter episodes…" value={epFilter}
            onChange={e => setEpFilter(e.target.value)}
            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white dark:placeholder-gray-500" />
        </div>
        <button onClick={() => setEpView(v => v === 'list' ? 'grid' : 'list')}
          className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-gray-600 dark:text-gray-400 shrink-0">
          {epView === 'list' ? <Eye className="w-4 h-4" /> : <List className="w-4 h-4" />}
        </button>
      </div>

      <div className="max-h-[400px] lg:max-h-[600px] overflow-y-auto">
        {totalEps === 0 && !loading ? (
          <div className="p-4 text-center text-sm text-gray-500">Episode info unavailable.</div>
        ) : loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3 border-b border-gray-100 dark:border-gray-800 animate-pulse">
              <div className="w-12 h-12 shrink-0 rounded bg-gray-200 dark:bg-gray-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
              </div>
            </div>
          ))
        ) : filteredEps.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">No episodes found.</div>
        ) : epView === 'grid' ? (
          <div className="grid grid-cols-6 gap-1.5 p-2">
            {filteredEps.map(ep => {
              const isActive = ep === episode;
              return (
                <Link key={ep} to={`/watch/${id}/${ep}`}
                  className={`aspect-square flex items-center justify-center rounded text-xs font-bold transition-colors ${
                    isActive ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}>
                  {isActive ? <Play className="w-3 h-3 fill-current" /> : ep}
                </Link>
              );
            })}
          </div>
        ) : (
          filteredEps.map(ep => {
            const isActive = ep === episode;
            const streamEp = anime?.streamingEpisodes?.[ep - 1];
            const epTitle = streamEp?.title;
            const epThumb = streamEp?.thumbnail || posterImg;
            return (
              <Link key={ep} to={`/watch/${id}/${ep}`}
                onClick={() => addToHistory({ title, image: epThumb, url: `/watch/${id}/${ep}`, subtitle: `EP ${ep}` })}
                className={`flex gap-3 p-2 border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group items-center ${isActive ? 'bg-gray-100 dark:bg-gray-800' : ''}`}>
                <div className={`w-20 h-12 shrink-0 rounded overflow-hidden relative border transition-colors ${
                  isActive ? 'border-indigo-400' : 'border-gray-200 dark:border-gray-700 group-hover:border-gray-400'
                }`}>
                  <img src={epThumb} alt={`Episode ${ep}`} className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = posterImg; }} />
                  <div className={`absolute inset-0 flex items-center justify-center bg-black/30 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <Play className="w-4 h-4 fill-current text-white drop-shadow" />
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center py-1">
                  <h4 className={`text-xs font-bold truncate transition-colors ${
                    isActive ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white'
                  }`}>
                    {epTitle && epTitle !== `Episode ${ep}` ? epTitle : `Episode ${ep}`}
                  </h4>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-0.5 flex items-center gap-1">
                    <span className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">{audio.toUpperCase()}</span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Main Watch Component ─────────────────────────────────────────────────────
export default function Watch() {
  const { id, episode: epParam } = useParams<{ id: string; episode: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const episode = parseInt(epParam || '1', 10);

  const [audio, setAudio] = useState<AudioType>('sub');
  const [activeServerId, setActiveServerId] = useState<string>('kiwi');
  const [iframeError, setIframeError] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('Link copied!');
  const [epFilter, setEpFilter] = useState('');
  const [epView, setEpView] = useState<'list' | 'grid'>('list');
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('av_autonext') !== 'false');
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const [airingSecondsLeft, setAiringSecondsLeft] = useState<number | null>(null);

  // Kiwi state
  const [kiwiData, setKiwiData] = useState<KiwiStreamData | null>(null);
  const [kiwiLoading, setKiwiLoading] = useState(false);
  const [kiwiError, setKiwiError] = useState<string | null>(null);
  const [kiwiQuality, setKiwiQuality] = useState<string>('720p');

  const autoNextTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const airingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: anime, isPending: loading } = useAnimeDetails(id!);
  const {
    favorited, watchlisted, favLoading, wlLoading,
    handleToggleFavorite, handleToggleWatchlist,
  } = useList(
    id || '', token,
    anime?.title?.english || anime?.title?.romaji || '',
    anime?.coverImage?.extraLarge || '',
  );

  const isKiwi = activeServerId === 'kiwi';
  const activeServer = STREAM_SERVERS.find(s => s.id === activeServerId);
  const embedUrl = (!isKiwi && activeServer && id) ? activeServer.getUrl(id, episode, audio) : '';

  // Best kwik.cx embed URL for selected quality
  // Priority: exact quality + isActive → exact quality → any isActive embed → first embed
  const kiwiEmbedUrl = (() => {
    if (!kiwiData?.streams?.length) return '';
    const allEmbeds = kiwiData.streams.filter(s => s.type === 'embed' && s.url?.includes('kwik.cx'));
    if (!allEmbeds.length) {
      // Fallback: try any embed URL even if not kwik.cx
      const anyEmbed = kiwiData.streams.filter(s => s.type === 'embed');
      return (anyEmbed.find(s => s.quality === kiwiQuality && s.isActive)
        || anyEmbed.find(s => s.quality === kiwiQuality)
        || anyEmbed.find(s => s.isActive)
        || anyEmbed[0])?.url || '';
    }
    return (
      allEmbeds.find(s => s.quality === kiwiQuality && s.isActive)
      || allEmbeds.find(s => s.quality === kiwiQuality)
      || allEmbeds.find(s => s.isActive)
      || allEmbeds[0]
    )?.url || '';
  })();

  const finalEmbedUrl = isKiwi ? kiwiEmbedUrl : embedUrl;

  // Quality options from kiwi streams (kwik.cx embeds preferred)
  const kiwiQualities = (() => {
    if (!kiwiData?.streams?.length) return [];
    const seen = new Set<string>();
    // Prefer kwik.cx embeds, fallback to all embeds
    const embeds = kiwiData.streams.filter(s =>
      s.type === 'embed' && (s.url?.includes('kwik.cx') || true)
    );
    return embeds
      .filter(s => !seen.has(s.quality) && seen.add(s.quality))
      .map(s => s.quality)
      .sort((a, b) => parseInt(b) - parseInt(a));
  })();

  const airedEps = anime?.nextAiringEpisode
    ? anime.nextAiringEpisode.episode - 1
    : anime?.episodes || 0;
  const totalEps = airedEps > 0 ? airedEps : (anime?.episodes || 0);
  const title = anime ? (anime.title.english || anime.title.romaji || 'Anime') : 'Anime';
  const posterImg = anime?.coverImage?.extraLarge || anime?.coverImage?.large || FALLBACK_IMAGE;

  const prevEp = episode > 1 ? episode - 1 : null;
  const nextEp = totalEps > 0 && episode < totalEps ? episode + 1 : null;
  const nextAiring = anime?.nextAiringEpisode;

  const epNums = totalEps > 0 ? Array.from({ length: totalEps }, (_, i) => i + 1) : [];
  const filteredEps = epFilter ? epNums.filter(n => String(n).includes(epFilter)) : epNums;

  const relations = (anime?.relations?.edges || [])
    .filter((e: any) => e.node?.type === 'ANIME')
    .map((e: any) => ({
      id: e.node.id,
      title: e.node.title?.english || e.node.title?.romaji || '',
      image: e.node.coverImage?.large || FALLBACK_IMAGE,
      relationType: e.relationType,
      format: e.node.format || '',
      year: e.node.seasonYear || '',
    }));

  // Fetch kiwi streams
  useEffect(() => {
    if (!isKiwi || !id) return;
    setKiwiData(null);
    setKiwiError(null);
    setKiwiLoading(true);
    fetchKiwiStreams(id, episode, audio)
      .then(data => {
        setKiwiData(data);
        const embeds = data.streams.filter(s => s.type === 'embed');
        // Prefer the isActive stream's quality, else highest quality
        const activeEmbed = embeds.find(s => s.isActive);
        const quals = embeds
          .map(s => s.quality)
          .filter((q, i, arr) => arr.indexOf(q) === i)
          .sort((a, b) => parseInt(b) - parseInt(a));
        if (activeEmbed) {
          setKiwiQuality(activeEmbed.quality);
        } else if (quals.length > 0) {
          setKiwiQuality(quals[0]);
        }
      })
      .catch(err => setKiwiError(err.message || 'Failed to load Kiwi streams'))
      .finally(() => setKiwiLoading(false));
  }, [isKiwi, id, episode, audio]);

  useEffect(() => { setIframeError(false); }, [id, episode, activeServerId, audio]);

  useEffect(() => {
    if (anime && id) addToHistory({ title, image: posterImg, url: `/watch/${id}/${episode}`, subtitle: `EP ${episode}` });
  }, [anime, id, episode]);

  useEffect(() => {
    if (airingTimer.current) clearInterval(airingTimer.current);
    if (!nextAiring?.airingAt) { setAiringSecondsLeft(null); return; }
    const tick = () => setAiringSecondsLeft(getSecondsUntilAiring(nextAiring.airingAt));
    tick();
    airingTimer.current = setInterval(tick, 60000);
    return () => { if (airingTimer.current) clearInterval(airingTimer.current); };
  }, [nextAiring?.airingAt]);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) clearInterval(autoNextTimer.current);
    setAutoNextCountdown(null);
  }, []);

  useEffect(() => {
    return () => {
      if (autoNextTimer.current) clearInterval(autoNextTimer.current);
      if (airingTimer.current) clearInterval(airingTimer.current);
    };
  }, []);

  // Fix: reset viewport scale after exiting fullscreen (Android/iOS zoom bug)
  useEffect(() => {
    const resetViewport = () => {
      if (!document.fullscreenElement) {
        const viewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
        if (viewport) {
          viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
          // Briefly allow scale reset then restore
          setTimeout(() => {
            viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
          }, 100);
        }
      }
    };
    document.addEventListener('fullscreenchange', resetViewport);
    document.addEventListener('webkitfullscreenchange', resetViewport);
    return () => {
      document.removeEventListener('fullscreenchange', resetViewport);
      document.removeEventListener('webkitfullscreenchange', resetViewport);
    };
  }, []);

  const toggleAutoNext = () => {
    const next = !autoNext;
    setAutoNext(next);
    localStorage.setItem('av_autonext', String(next));
    if (!next) cancelAutoNext();
  };

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToastMsg('Link copied to clipboard!');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
    } catch {}
  }, []);

  const handleNext = useCallback(() => {
    if (nextEp) { cancelAutoNext(); navigate(`/watch/${id}/${nextEp}`); }
  }, [nextEp, id, navigate, cancelAutoNext]);

  const handlePrev = useCallback(() => {
    if (prevEp) navigate(`/watch/${id}/${prevEp}`);
  }, [prevEp, id, navigate]);

  const handleDownload = useCallback(() => {
    if (kiwiData?.download) window.open(kiwiData.download, '_blank', 'noopener,noreferrer');
  }, [kiwiData]);

  // Dropdown options
  const audioOptions: DropdownOption[] = [
    {
      label: 'Sub', value: 'sub',
      icon: <span className="text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1 py-0.5 rounded">CC</span>,
    },
    { label: 'Dub', value: 'dub', icon: <Mic className="w-3.5 h-3.5" /> },
  ];

  const serverOptions: DropdownOption[] = [
    { label: 'kiwi', value: 'kiwi' },
    { label: 'Fast', value: 'fast' },
    { label: 'VidNest', value: 'vidnest' },
    { label: 'Server 3', value: 'anime4up', badge: 'EMBED' },
  ];

  return (
    <div className="max-w-[1600px] mx-auto md:p-6 transition-colors relative z-20 px-2 pt-2 md:px-0 md:pt-0">
      <SEOHead
        title={anime ? `Watch ${title} Episode ${episode} – AniWave` : 'Watch Anime – AniWave'}
        description={anime ? stripHtml(anime.description).slice(0, 160) : ''}
        image={posterImg}
        url={`/watch/${id}/${episode}`}
        type="video.tv_show"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 md:gap-6 relative z-50">

        {/* ── Left: Video + Controls ── */}
        <div className="lg:col-span-2 space-y-3 md:space-y-4">

          {/* 16:9 Player - subtle rounded corners like Miruro */}
          <div className="w-full bg-black rounded-md overflow-hidden relative" style={{ paddingTop: '56.25%' }}>
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            ) : isKiwi && kiwiLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-gray-900">
                <div className="w-10 h-10 border-4 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                <p className="text-sm text-gray-400">Loading Kiwi streams…</p>
              </div>
            ) : isKiwi && kiwiError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-gray-900 px-6 text-center">
                <AlertCircle className="w-10 h-10 text-red-400" />
                <p className="text-sm text-gray-300">{kiwiError}</p>
                <p className="text-xs text-gray-500">Try switching Sub ↔ Dub or another server.</p>
              </div>
            ) : isKiwi && !kiwiEmbedUrl && !kiwiLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-gray-900">
                <AlertCircle className="w-10 h-10 text-yellow-400" />
                <p className="text-sm text-gray-300">No streams available for this episode.</p>
              </div>
            ) : iframeError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 bg-gray-900">
                <AlertCircle className="w-10 h-10 text-red-400" />
                <p className="text-sm text-gray-300">Failed to load. Try another server.</p>
                <div className="flex gap-2 flex-wrap justify-center">
                  {SERVERS.filter(s => s.id !== activeServerId).map(sv => (
                    <button key={sv.id} onClick={() => { setActiveServerId(sv.id); setIframeError(false); }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-bold">
                      Try {sv.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : finalEmbedUrl ? (
              <iframe
                key={`${id}-${episode}-${audio}-${activeServerId}-${kiwiQuality}`}
                src={finalEmbedUrl}
                className="absolute inset-0 w-full h-full border-0 outline-none"
                allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy={isKiwi ? "no-referrer-when-downgrade" : "origin"}
                title={`${title} Episode ${episode}`}
                style={{ pointerEvents: 'auto' }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Auto-next countdown bar */}
          {autoNextCountdown !== null && nextEp && (
            <div className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 mx-4 md:mx-0">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Timer className="w-4 h-4" /> Next episode in {autoNextCountdown}s
              </span>
              <div className="flex gap-2">
                <button onClick={handleNext} className="px-3 py-1.5 bg-gray-900 dark:bg-gray-700 text-white rounded text-xs font-bold flex items-center gap-1">
                  <Play className="w-3 h-3 fill-current" /> Play Now
                </button>
                <button onClick={cancelAutoNext} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-bold dark:text-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300 px-4 md:px-0">
            <button onClick={toggleAutoNext}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${autoNext ? 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200' : 'bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700'}`}>
              <div className={`w-2 h-2 rounded-sm ${autoNext ? 'bg-gray-800 dark:bg-gray-200' : 'bg-gray-400 dark:bg-gray-500'}`} /> Autoplay
            </button>
            <button onClick={toggleAutoNext}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${autoNext ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700'}`}>
              <div className={`w-2 h-2 rounded-sm ${autoNext ? 'bg-indigo-500' : 'bg-gray-400 dark:bg-gray-500'}`} /> Auto Skip
            </button>
            <button onClick={handlePrev} disabled={!prevEp}
              className="px-3 py-1.5 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              <SkipBack className="w-3.5 h-3.5" /> EP {prevEp ?? '—'}
            </button>
            <button onClick={handleNext} disabled={!nextEp}
              className="px-3 py-1.5 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Next <SkipForward className="w-3.5 h-3.5" />
            </button>

          </div>

          {/* ── Episode info + Miruro-style controls ── */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-4 mx-4 md:mx-0">

            {/* Episode title */}
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {loading ? 'Loading…' : `${episode}. ${
                anime?.streamingEpisodes?.[episode - 1]?.title
                  ? anime.streamingEpisodes[episode - 1].title.replace(/^.*? - /, '')
                  : 'Episode ' + episode
              }`}
            </h1>

            {/* Sub/Dub + Server pill dropdowns */}
            <div className="flex flex-wrap items-center gap-3">
              <DropdownPill
                icon={audio === 'sub'
                  ? <span className="text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1 py-0.5 rounded">CC</span>
                  : <Mic className="w-3.5 h-3.5" />}
                value={audio}
                options={audioOptions}
                onChange={v => { setAudio(v as AudioType); setIframeError(false); }}
              />
              <DropdownPill
                icon={<Zap className="w-3.5 h-3.5" />}
                value={activeServerId}
                options={serverOptions}
                onChange={v => { setActiveServerId(v); setIframeError(false); }}
              />

              {/* Kiwi quality buttons */}
              {isKiwi && kiwiQualities.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {kiwiQualities.map(q => (
                    <button key={q} onClick={() => setKiwiQuality(q)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        kiwiQuality === q ? 'bg-indigo-500 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700'
                      }`}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>



            {/* Date + Report + Download + Share */}
            <div className="flex flex-wrap items-center gap-2">
              {anime?.startDate?.year && (
                <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {[anime.startDate.year, anime.startDate.month ? String(anime.startDate.month).padStart(2,'0') : null, anime.startDate.day ? String(anime.startDate.day).padStart(2,'0') : null].filter(Boolean).join(' / ')}
                </span>
              )}
              <button className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 flex items-center gap-1.5 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Flag className="w-3.5 h-3.5" /> Report
              </button>
              <button
                onClick={isKiwi && kiwiData?.download ? handleDownload : undefined}
                disabled={!isKiwi || !kiwiData?.download}
                title={!isKiwi ? 'Switch to Kiwi server for downloads' : !kiwiData?.download ? 'No download available' : 'Download this episode'}
                className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-medium border transition-colors ${
                  isKiwi && kiwiData?.download
                    ? 'bg-indigo-500 hover:bg-indigo-600 border-indigo-500 text-white cursor-pointer shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-60'
                }`}>
                <Download className="w-3.5 h-3.5" /> Download
              </button>
              <button onClick={handleShare}
                className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 flex items-center gap-1.5 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Share2 className="w-3.5 h-3.5" /> Share
              </button>
            </div>

            {/* Airing countdown */}
            {nextAiring && nextAiring.episode > episode && airingSecondsLeft !== null && airingSecondsLeft > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Timer className="w-3.5 h-3.5" /> EP {nextAiring.episode} airs in {formatCountdown(airingSecondsLeft)}
              </p>
            )}
          </div>

          {/* Favorite + Watchlist */}
          <div className="flex flex-wrap items-center gap-2 px-4 md:px-0">
            <button onClick={handleToggleFavorite} disabled={!token || favLoading}
              className={`px-3 py-2 rounded-md flex items-center gap-1.5 text-sm font-medium transition-colors ${favorited ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'} disabled:opacity-50`}>
              <Heart className={`w-4 h-4 ${favorited ? 'fill-current' : ''}`} /> Favorite
            </button>
            <button onClick={handleToggleWatchlist} disabled={!token || wlLoading}
              className={`px-3 py-2 rounded-md flex items-center gap-1.5 text-sm font-medium transition-colors ${watchlisted ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'} disabled:opacity-50`}>
              <Bookmark className={`w-4 h-4 ${watchlisted ? 'fill-current' : ''}`} /> Watchlist
            </button>
          </div>

          {/* ── MOBILE ONLY: Episode list (shown before anime details) ── */}
          <div className="lg:hidden px-2 md:px-0">
            <EpisodePanel
              loading={loading}
              totalEps={totalEps}
              epFilter={epFilter}
              setEpFilter={setEpFilter}
              epView={epView}
              setEpView={setEpView}
              filteredEps={filteredEps}
              episode={episode}
              id={id!}
              anime={anime}
              posterImg={posterImg}
              audio={audio}
              title={title}
            />
          </div>

          {/* ── Anime details card — compact horizontal layout like reference ── */}
          <div className="mx-2 md:mx-0">
            {loading ? (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-24 shrink-0 aspect-[3/4] rounded-lg bg-gray-200 dark:bg-gray-800" />
                  <div className="flex-1 space-y-3 py-1">
                    <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-2/3" />
                  </div>
                </div>
              </div>
            ) : anime ? (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                {/* Mobile: compact side-by-side like reference screenshot */}
                <div className="flex gap-4">
                  {/* Poster */}
                  <div className="shrink-0 space-y-2">
                    <img src={posterImg} alt={title}
                      className="w-28 aspect-[3/4] object-cover rounded-lg bg-gray-100 dark:bg-gray-800"
                      onError={e => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }} />
                    {/* Trailer / + / AL / MAL buttons like reference */}
                    <div className="flex gap-1.5">
                      {/* DETAILS button */}
                    <Link to={`/anime/${id}`}
                      className="flex-1 py-1.5 bg-gray-800 dark:bg-gray-700 text-white rounded-md text-[10px] font-bold flex items-center justify-center gap-1 transition-colors">
                      <Info className="w-3 h-3" /> DETAILS
                    </Link>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link to={`/anime/${id}`}
                      className="text-base font-black text-gray-900 dark:text-white hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors block mb-0.5 leading-tight">
                      {title}
                    </Link>
                    {anime.title?.native && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic mb-2">{anime.title.native}</p>
                    )}

                    {/* Genre tags like reference — orange/amber style */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(anime.genres || []).map((g: string, i: number) => (
                        <Link key={g} to={`/genre/${encodeURIComponent(g)}`}
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold hover:opacity-90 transition-opacity"
                          style={{ backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length].bg, color: GENRE_COLORS[i % GENRE_COLORS.length].text }}>
                          {g}
                        </Link>
                      ))}
                    </div>

                    {/* Stats grid like reference */}
                    <div className="space-y-1 text-xs">
                      {anime.format && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Format:</span><span className="font-bold dark:text-white">{anime.format}</span></div>
                      )}
                      {anime.status && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Status:</span><span className="font-bold dark:text-white">{anime.status === 'RELEASING' ? 'Airing' : anime.status === 'FINISHED' ? 'Finished' : anime.status}</span></div>
                      )}
                      {anime.episodes && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Episodes:</span><span className="font-bold dark:text-white">{anime.episodes}</span></div>
                      )}
                      {anime.averageScore && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Rating:</span><span className="font-bold dark:text-white">{anime.averageScore} <span className="font-normal text-gray-400">/100</span></span></div>
                      )}
                      {anime.startDate?.year && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Start Date:</span><span className="font-bold dark:text-white">{[anime.startDate.month ? new Date(0, anime.startDate.month - 1).toLocaleString('en', { month: 'long' }) : null, anime.startDate.day, anime.startDate.year].filter(Boolean).join(' ')}</span></div>
                      )}
                      {anime.studios?.nodes?.[0]?.name && (
                        <div className="flex gap-1"><span className="text-gray-500 dark:text-gray-400">Studios:</span><span className="font-bold dark:text-white">{anime.studios.nodes[0].name}</span></div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description below on mobile */}
                {anime.description && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-3 leading-relaxed line-clamp-4">
                    {stripHtml(anime.description)}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {/* Comments */}
          <div className="mx-2 md:mx-0">
            <CommentSection episodeId={`anime-${id}-ep${episode}`} />
          </div>

          {/* Relations */}
          {relations.length > 0 && (
            <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mx-2 md:mx-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><ChevronRight className="w-4 h-4" /> Related Anime</h3>
              <div className="space-y-3">
                {relations.map((r: any) => (
                  <Link key={r.id} to={`/anime/${r.id}`} className="flex gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg p-1.5 -mx-1.5 transition-colors group">
                    <img src={r.image} alt={r.title} className="w-12 h-16 object-cover rounded shrink-0" onError={e => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }} />
                    <div className="flex-1 min-w-0 py-0.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">{r.relationType?.replace(/_/g, ' ')}</span>
                      <p className="text-xs font-bold text-gray-800 dark:text-gray-200 group-hover:text-gray-600 dark:group-hover:text-gray-400 line-clamp-2">{r.title}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{r.format} {r.year ? `· ${r.year}` : ''}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Episode list (desktop only) ── */}
        <div className="hidden lg:block space-y-6">
          <EpisodePanel
            loading={loading}
            totalEps={totalEps}
            epFilter={epFilter}
            setEpFilter={setEpFilter}
            epView={epView}
            setEpView={setEpView}
            filteredEps={filteredEps}
            episode={episode}
            id={id!}
            anime={anime}
            posterImg={posterImg}
            audio={audio}
            title={title}
          />

          {/* Ad */}
          <div className="w-full aspect-[4/3] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center border border-gray-200 dark:border-gray-700">
            <span className="text-2xl font-light text-gray-400 dark:text-gray-600">Advertisement</span>
          </div>
        </div>
      </div>

      <Toast message={toastMsg} show={showToast} />
    </div>
  );
}
