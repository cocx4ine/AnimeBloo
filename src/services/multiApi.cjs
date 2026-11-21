const cache = require('../anime-api.cjs');
const { cleanSynopsis } = require('../synopsis.cjs');

const COVER_FALLBACK = './assets/fallback-cover.svg';
const THUMBNAIL_FALLBACK = './assets/fallback-thumbnail.svg';
const TTL = { anilist: 30 * 60_000, aniZip: 12 * 60 * 60_000, kitsu: 24 * 60 * 60_000, jikan: 24 * 60 * 60_000 };
const SPACING = { anilist: 350, aniZip: 250, kitsu: 400, jikan: 1100 };
const inFlight = new Map();
const nextStart = new Map();
let generation = 0;

const MEDIA_FIELDS = 'id idMal title { romaji english native } startDate { year month day } season seasonYear duration nextAiringEpisode { airingAt episode } coverImage { extraLarge large medium } bannerImage averageScore status genres isAdult description(asHtml: false) episodes';

function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Home request timed out')), ms); })]).finally(() => clearTimeout(timer));
}

function positiveId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError('Invalid AniList ID');
  return number;
}

function cleanUrl(value) {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

function normalizedTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchingKitsu(anime, candidates) {
  const titles = Object.values(anime.title || {}).map(normalizedTitle).filter(Boolean);
  return (candidates || []).find((item) => {
    const attributes = item.attributes || {};
    const theirs = [attributes.canonicalTitle, ...Object.values(attributes.titles || {})].map(normalizedTitle);
    return theirs.some((title) => title && titles.includes(title));
  });
}

function enqueue(provider, operation) {
  const start = Math.max(Date.now(), nextStart.get(provider) || 0);
  nextStart.set(provider, start + SPACING[provider]);
  return new Promise((resolve, reject) => setTimeout(() => Promise.resolve().then(operation).then(resolve, reject), Math.max(0, start - Date.now())));
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    const error = new Error(`API request failed: ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after')) || 0;
    throw error;
  }
  return response.json();
}

async function cached(provider, key, request) {
  const entry = cache.get(provider, key);
  if (entry && entry.expires > Date.now()) return entry.value;
  const flightKey = `${provider}:${key}`;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);
  const startedAt = generation;
  const promise = enqueue(provider, async () => {
    try {
      return await request();
    } catch (error) {
      if (error.status === 429 && error.retryAfter > 0) {
        nextStart.set(provider, Math.max(nextStart.get(provider) || 0, Date.now() + Math.min(error.retryAfter, 60) * 1000));
      }
      throw error;
    }
  }).then((value) => {
    if (startedAt === generation) cache.set(provider, key, { value, expires: Date.now() + TTL[provider] });
    return value;
  }).finally(() => { if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey); });
  inFlight.set(flightKey, promise);
  return promise;
}

function anilist(query, variables, key) {
  return cached('anilist', key, async () => {
    const result = await jsonRequest('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (result.errors?.length) throw new Error(result.errors[0].message || 'AniList error');
    return result.data;
  });
}

async function privateAniList(session, query, variables = {}) {
  if (!session?.token || !Number.isSafeInteger(session.id)) return null;
  const result = await jsonRequest('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (result.errors?.length) throw new Error(result.errors[0].message || 'AniList error');
  return result.data;
}

function safeText(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : '';
}

function baseAnime(media) {
  if (!media) return null;
  return {
    id: media.id,
    malId: Number.isSafeInteger(media.idMal) && media.idMal > 0 ? media.idMal : null,
    year: media.startDate?.year || media.seasonYear || null,
    season: media.season || null,
    duration: Number.isFinite(media.duration) ? media.duration : null,
    title: { romaji: media.title?.romaji || '', english: media.title?.english || '', native: media.title?.native || '' },
    cover: cleanUrl(media.coverImage?.extraLarge) || cleanUrl(media.coverImage?.large) || cleanUrl(media.coverImage?.medium) || COVER_FALLBACK,
    banner: cleanUrl(media.bannerImage) || cleanUrl(media.coverImage?.extraLarge) || cleanUrl(media.coverImage?.large) || cleanUrl(media.coverImage?.medium) || THUMBNAIL_FALLBACK,
    score: Number.isFinite(media.averageScore) ? media.averageScore : null,
    genres: Array.isArray(media.genres) ? media.genres.filter((genre) => typeof genre === 'string').slice(0, 5) : [],
    status: media.status || null,
    description: cleanSynopsis(media.description),
    episodeCount: media.episodes || null,
    startDate: media.startDate?.year && media.startDate?.month && media.startDate?.day ? `${media.startDate.year}-${String(media.startDate.month).padStart(2, '0')}-${String(media.startDate.day).padStart(2, '0')}` : null,
    nextAiringAt: Number.isSafeInteger(media.nextAiringEpisode?.airingAt) ? media.nextAiringEpisode.airingAt : null,
    episodes: [],
  };
}

function titleFor(episode, language) {
  const title = episode.title;
  if (typeof title === 'string') return title;
  return title?.[language] || title?.en || title?.['x-jat'] || title?.ja || Object.values(title || {}).find(Boolean) || '';
}

function normalizeEpisodes(data, language = 'en', backdrop = THUMBNAIL_FALLBACK) {
  return Object.entries(data?.episodes || {}).map(([key, episode]) => {
    const number = Number(key);
    if (!Number.isSafeInteger(number) || number <= 0 || !episode || typeof episode !== 'object') return null;
    return {
      number,
      absoluteNumber: Number.isSafeInteger(Number(episode.absoluteEpisodeNumber)) && Number(episode.absoluteEpisodeNumber) > 0 ? Number(episode.absoluteEpisodeNumber) : null,
      seasonNumber: Number.isSafeInteger(Number(episode.seasonNumber)) ? Number(episode.seasonNumber) : null,
      seasonEpisodeNumber: Number.isSafeInteger(Number(episode.episodeNumber)) ? Number(episode.episodeNumber) : null,
      title: titleFor(episode, language) || `Episode ${number}`,
      thumbnail: cleanUrl(episode.image) || backdrop,
      aniZipThumbnail: cleanUrl(episode.image),
      summary: cleanSynopsis(episode.summary || episode.overview),
    };
  }).filter(Boolean).sort((a, b) => a.number - b.number);
}

function mappedKitsuId(mapping, anilistId, malId) {
  const ids = mapping?.mappings;
  if (!ids || Number(ids.anilist_id) !== anilistId || (malId && ids.mal_id && Number(ids.mal_id) !== malId)) return null;
  const id = Number(ids.kitsu_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function kitsuEpisodes(kitsuId, targetNumber = null) {
  const episodes = new Map();
  for (let offset = 0; offset < 400; offset += 20) {
    const page = await cached('kitsu', `episodes:${kitsuId}:${offset}`, () => jsonRequest(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${offset}`, { headers: { Accept: 'application/vnd.api+json' } }));
    const items = Array.isArray(page?.data) ? page.data : [];
    for (const item of items) {
      const number = Number(item?.attributes?.number);
      if (!Number.isSafeInteger(number) || number < 1) continue;
      const thumbnail = cleanUrl(item.attributes.thumbnail?.original) || cleanUrl(item.attributes.thumbnail?.large);
      episodes.set(number, { number, thumbnail, title: safeText(item.attributes.canonicalTitle), summary: cleanSynopsis(item.attributes.synopsis) });
    }
    if ((targetNumber && episodes.has(targetNumber)) || items.length < 20 || !page.links?.next) break;
  }
  return episodes;
}

function mergeEpisodeArtwork(episodes, kitsu, anime) {
  const backdrop = anime.banner !== THUMBNAIL_FALLBACK ? anime.banner : anime.cover;
  const numbers = episodes.length ? episodes.map((episode) => episode.number) : [...kitsu.keys()];
  const byNumber = new Map(episodes.map((episode) => [episode.number, episode]));
  return numbers.map((number) => {
    const entry = byNumber.get(number);
    const other = kitsu.get(number);
    return {
      ...(entry || { number, title: other?.title || `Episode ${number}`, summary: other?.summary || '' }),
      thumbnail: entry?.aniZipThumbnail || other?.thumbnail || backdrop,
      kitsuThumbnail: other?.thumbnail || null,
    };
  });
}

async function artFallback(media, anime) {
  const needsCover = !cleanUrl(media.coverImage?.extraLarge) || /\/(medium|small|tiny)\b/i.test(media.coverImage.extraLarge);
  const needsBanner = !cleanUrl(media.bannerImage);
  if (!needsCover && !needsBanner) return anime;
  const title = media.title?.english || media.title?.romaji || media.title?.native;
  if (title) {
    try {
      const result = await cached('kitsu', normalizedTitle(title), () => jsonRequest(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=8`, { headers: { Accept: 'application/vnd.api+json' } }));
      const match = matchingKitsu(anime, result.data);
      if (match) {
        const art = match.attributes || {};
        if (needsCover) anime.cover = cleanUrl(art.posterImage?.original) || cleanUrl(art.posterImage?.large) || anime.cover;
        if (needsBanner) anime.banner = cleanUrl(art.coverImage?.original) || cleanUrl(art.coverImage?.large) || anime.banner;
      }
    } catch { /* AniList and the local artwork remain available. */ }
  }
  // AniList's idMal is an exact cross-reference, unlike a fuzzy title search.
  if (needsCover && media.idMal && anime.cover === baseAnime(media).cover) {
    try {
      const result = await cached('jikan', String(media.idMal), () => jsonRequest(`https://api.jikan.moe/v4/anime/${media.idMal}`));
      anime.cover = cleanUrl(result.data?.images?.jpg?.large_image_url) || anime.cover;
    } catch { /* Keep the best artwork already available. */ }
  }
  if (anime.banner === THUMBNAIL_FALLBACK) anime.banner = anime.cover === COVER_FALLBACK ? THUMBNAIL_FALLBACK : anime.cover;
  return anime;
}

function createMultiApi() {
  async function searchAnime(term) {
    const search = String(term || '').trim().slice(0, 100);
    if (search.length < 2) return [];
    const data = await anilist(`query ($search: String) { Page(page: 1, perPage: 12) { media(type: ANIME, search: $search, isAdult: false) { ${MEDIA_FIELDS} } } }`, { search }, `search:${normalizedTitle(search)}`);
    return (data?.Page?.media || []).map(baseAnime).filter(Boolean);
  }

  async function getAnime(id, language = 'en') {
    const animeId = positiveId(id);
    const data = await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`, { id: animeId }, `media:${animeId}`);
    if (!data?.Media) return null;
    const media = data.Media;
    const anime = baseAnime(media);
    const episodes = cached('aniZip', String(animeId), () => jsonRequest(`https://api.ani.zip/mappings?anilist_id=${animeId}`));
    const [, episodeResult] = await Promise.allSettled([artFallback(media, anime), episodes]);
    const received = episodeResult.status === 'fulfilled' ? episodeResult.value : null;
    const mapping = received?.mappings && (Number(received.mappings.anilist_id) !== animeId || (media.idMal && received.mappings.mal_id && Number(received.mappings.mal_id) !== media.idMal)) ? null : received;
    if (mapping) {
      const images = Array.isArray(mapping.images) ? mapping.images : [];
      if (anime.cover === COVER_FALLBACK) anime.cover = cleanUrl(images.find((image) => image.coverType === 'Poster')?.url) || anime.cover;
      if (anime.banner === THUMBNAIL_FALLBACK) anime.banner = cleanUrl(images.find((image) => image.coverType === 'Banner')?.url) || anime.cover || THUMBNAIL_FALLBACK;
      anime.episodes = normalizeEpisodes(mapping, language, anime.banner !== THUMBNAIL_FALLBACK ? anime.banner : anime.cover);
    }
    const kitsuId = mappedKitsuId(mapping, animeId, media.idMal);
    if (kitsuId && (!anime.episodes.length || anime.episodes.some((episode) => !episode.aniZipThumbnail))) {
      try { anime.episodes = mergeEpisodeArtwork(anime.episodes, await kitsuEpisodes(kitsuId), anime); }
      catch { /* Ani.zip and AniList artwork remain available. */ }
    }
    return anime;
  }

  async function getHomeFeed(session) {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = Number(new Date((now - 86400) * 1000).toISOString().slice(0, 10).replace(/-/g, ''));
    const publicFeed = anilist(`query ($now: Int, $since: Int, $yesterday: FuzzyDateInt) { trending: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, sort: TRENDING_DESC) { ${MEDIA_FIELDS} } } upcoming: Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, startDate_greater: $yesterday, sort: START_DATE) { ${MEDIA_FIELDS} } } recent: Page(page: 1, perPage: 20) { airingSchedules(airingAt_lesser: $now, airingAt_greater: $since, sort: TIME_DESC) { episode airingAt media { ${MEDIA_FIELDS} } } } }`, { now, since: now - 7 * 86400, yesterday }, `home:feed:${Math.floor(now / 1800)}`);
    const library = privateAniList(session, `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { status progress media { id genres isAdult } } } } Viewer { favourites { anime(page: 1, perPage: 50) { nodes { id } } } } }`, { userId: session?.id }).catch(() => null);
    const [publicResult, personalResult] = await Promise.allSettled([within(publicFeed, 3500), within(library, 2000)]);
    if (publicResult.status === 'rejected') throw publicResult.reason;
    const data = publicResult.value;
    const personal = personalResult.status === 'fulfilled' ? personalResult.value : null;
    const entries = (personal?.MediaListCollection?.lists || []).flatMap((list) => list.entries || []).filter((entry) => entry.media && !entry.media.isAdult);
    const counts = new Map();
    for (const entry of entries) {
      if (!['CURRENT', 'COMPLETED', 'REPEATING'].includes(entry.status)) continue;
      for (const genre of entry.media.genres || []) counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    const genres = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([genre]) => genre);
    const seen = new Set(entries.map((entry) => entry.media.id));
    const recommended = genres.length ? await within(anilist(`query ($genres: [String]) { Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, genre_in: $genres, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`, { genres }, `home:recommended:${genres.join('|')}`), 1200).then((result) => (result?.Page?.media || []).filter((media) => !seen.has(media.id)).slice(0, 12).map(baseAnime)).catch(() => []) : [];
    const schedules = (data?.recent?.airingSchedules || []).filter((item) => item.media && !item.media.isAdult);
    const latestByMedia = [...new Map(schedules.slice().reverse().map((item) => [item.media.id, item])).values()].sort((a, b) => b.airingAt - a.airingAt).slice(0, 10);
    const releases = latestByMedia.map((item) => {
      const anime = baseAnime(item.media);
      return { ...anime, releasedEpisode: item.episode, airedAt: item.airingAt, episodeThumbnail: anime.banner, aniZipThumbnail: null, kitsuThumbnail: null, episodeTitle: '' };
    });
    return { trending: (data?.trending?.media || []).map(baseAnime).filter(Boolean), upcoming: (data?.upcoming?.media || []).map(baseAnime).filter(Boolean), releases, recommended, current: entries.filter((entry) => entry.status === 'CURRENT').map((entry) => ({ id: entry.media.id, progress: entry.progress || 0 })), favorites: (personal?.Viewer?.favourites?.anime?.nodes || []).map((item) => item.id) };
  }

  async function getHomeReleaseArtwork(releases) {
    const items = Array.isArray(releases) ? releases.slice(0, 10) : [];
    const results = await Promise.allSettled(items.map(async (item) => {
      const id = positiveId(item.id);
      const mapping = await within(cached('aniZip', String(id), () => jsonRequest(`https://api.ani.zip/mappings?anilist_id=${id}`)), 2500);
      const episode = normalizeEpisodes(mapping).find((entry) => entry.number === item.releasedEpisode);
      return { id, aniZipThumbnail: episode?.aniZipThumbnail || null, episodeTitle: episode?.title || '' };
    }));
    return results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  }

  async function toggleFavorite(session, id) {
    const animeId = positiveId(id);
    await privateAniList(session, 'mutation ($animeId: Int) { ToggleFavourite(animeId: $animeId) { anime { nodes { id } } } }', { animeId });
    return true;
  }

  return { searchAnime, getAnime, getHomeFeed, getHomeReleaseArtwork, toggleFavorite };
}

function clearCache() {
  generation++;
  cache.clearCache();
  inFlight.clear();
  nextStart.clear();
}

module.exports = { createMultiApi, clearCache, normalizeEpisodes, matchingKitsu, baseAnime, COVER_FALLBACK, THUMBNAIL_FALLBACK };
