'use strict';

const PROVIDERS = Object.freeze(['AnimeSaturn', 'AnimeWorld', 'AnimeUnity', 'Anivexa', 'AllAnime', 'HiAnime']);

class ResolutionError extends Error {
  constructor(code, message, attempts = []) {
    super(message);
    this.name = 'ResolutionError';
    this.code = code;
    this.attempts = attempts;
  }
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new ResolutionError('INVALID_INPUT', `Invalid ${label}`);
  return number;
}

function normalizeTitle(value) {
  return String(value || '').replace(/\((?:ita|sub ita|dub|sub)\)/gi, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function titlesOf(value) {
  return [...new Set((typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.values(value || {}))
    .map(normalizeTitle).filter(Boolean))];
}

function matchingTitle(reference, candidate) {
  const expected = titlesOf(reference);
  const actual = titlesOf(candidate);
  return expected.length > 0 && actual.some((title) => expected.includes(title));
}

function titleScore(reference, candidate) {
  const expected = titlesOf(reference);
  const actual = titlesOf(candidate);
  let best = 0;
  for (const a of expected) for (const b of actual) {
    if (a === b) return 1;
    const at = new Set(a.split(' '));
    const bt = new Set(b.split(' '));
    const overlap = [...at].filter((word) => bt.has(word)).length;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
        diagonal = old;
      }
    }
    best = Math.max(best, (2 * overlap) / (at.size + bt.size), 1 - previous[b.length] / Math.max(a.length, b.length));
  }
  return best;
}

function verifiedCandidate(reference, candidate) {
  return Number(candidate?.year) === reference.year && titleScore(reference.titles, candidate?.titles || candidate?.title) >= 0.8 &&
    (!candidate.anilistId || Number(candidate.anilistId) === reference.anilistId) &&
    (!candidate.malId || !reference.malId || Number(candidate.malId) === reference.malId);
}

function episodeNumber(item) {
  for (const value of [item?.number, item?.episode, item?.episodeNumber, item?.absoluteNumber]) {
    if (Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value);
  }
  const match = String(item?.title || item?.name || '').match(/(?:episode|episodio|ep\.?|puntata)\s*0*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function chooseEpisode(items, number, title) {
  const candidates = (Array.isArray(items) ? items : [items]).filter(Boolean);
  const numbered = candidates.filter((item) => episodeNumber(item) === number);
  if (numbered.length) return numbered.sort((a, b) => titleScore(title, b.title || b.name) - titleScore(title, a.title || a.name))[0];
  // An unnumbered single result can be used only when it has no conflicting episode identity.
  return candidates.length === 1 && episodeNumber(candidates[0]) === null ? candidates[0] : null;
}

function safeMediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|.*\.localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function cleanStream(stream) {
  const url = safeMediaUrl(stream?.url || stream);
  if (!url) return null;
  const type = stream?.type || (/\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : /\.mp4(?:$|[?#])/i.test(url) ? 'mp4' : 'embed');
  if (!['hls', 'mp4'].includes(type)) return null;
  const rawQuality = stream?.height ?? stream?.quality ?? stream?.label ?? url;
  const height = Number(stream?.height) || Number(String(rawQuality).match(/(?:^|\D)(2160|1440|1080|720|480|360|240)p?(?:\D|$)/i)?.[1]) || 0;
  const referer = safeMediaUrl(stream?.referer || stream?.headers?.Referer);
  const subtitles = (Array.isArray(stream?.subtitles) ? stream.subtitles : []).map(track => ({
    url: safeMediaUrl(track.url), language: String(track.language || '').slice(0, 40), default: !!track.default,
  })).filter(track => track.url);
  const audioLanguage = String(stream?.audioLanguage || '').slice(0, 40).trim();
  const burnedSubtitles = String(stream?.burnedSubtitles || '').slice(0, 40).trim();
  const languages = key => [...new Set((Array.isArray(stream?.[key]) ? stream[key] : []).map(value => String(value).slice(0, 40).trim()).filter(value => /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(value)))];
  const audioLanguages = languages('audioLanguages');
  const subtitleLanguages = languages('subtitleLanguages');
  return { url, type, ...(stream?.mode ? { mode: stream.mode } : {}), ...(audioLanguage ? { audioLanguage } : {}), ...(burnedSubtitles ? { burnedSubtitles } : {}), ...(referer ? { referer } : {}), ...(height ? { height, label: `${height}p` } : {}), ...(subtitles.length ? { subtitles } : {}), ...(audioLanguages.length ? { audioLanguages } : {}), ...(subtitleLanguages.length ? { subtitleLanguages } : {}) };
}

function hlsLanguages(manifest) {
  const audioLanguages = new Set(), subtitleLanguages = new Set();
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const type = line.match(/(?:^|[:,])TYPE=(AUDIO|SUBTITLES)(?:,|$)/i)?.[1]?.toUpperCase();
    const language = line.match(/(?:^|,)LANGUAGE="([a-z]{2,3}(?:-[a-z0-9]+)*)"/i)?.[1];
    if (type === 'AUDIO' && language) audioLanguages.add(language);
    if (type === 'SUBTITLES' && language) subtitleLanguages.add(language);
  }
  return { audioLanguages: [...audioLanguages], subtitleLanguages: [...subtitleLanguages] };
}

function rankedStreams(streams) {
  const unique = new Map();
  for (const candidate of (Array.isArray(streams) ? streams : [streams]).map(cleanStream).filter(Boolean)) {
    const existing = unique.get(candidate.url);
    if (!existing || (candidate.height || 0) > (existing.height || 0)) unique.set(candidate.url, candidate);
  }
  return [...unique.values()].sort((a, b) => (b.height || 0) - (a.height || 0) ||
    ({ hls: 2, mp4: 1, embed: 0 }[b.type] - { hls: 2, mp4: 1, embed: 0 }[a.type]));
}

async function inspectHlsQuality(stream, fetchImpl) {
  if (stream.type !== 'hls') return stream;
  try {
    const response = await fetchImpl(stream.url, { headers: { Referer: stream.referer || new URL(stream.url).origin + '/', 'User-Agent': require('./mediaProxy.cjs').USER_AGENT }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return stream;
    const manifest = await response.text();
    if (!manifest.startsWith('#EXTM3U')) return stream;
    const heights = [...manifest.matchAll(/#EXT-X-STREAM-INF:[^\r\n]*\bRESOLUTION=\d+x(\d+)/gi)].map((match) => Number(match[1]));
    const height = Math.max(0, ...heights);
    const tracks = hlsLanguages(manifest);
    return { ...stream, audioLanguages: [...new Set([...(stream.audioLanguages || []), ...tracks.audioLanguages])], subtitleLanguages: [...new Set([...(stream.subtitleLanguages || []), ...tracks.subtitleLanguages])], ...(height ? { height, label: `${height}p` } : {}) };
  } catch { return stream; }
}

async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getReference(fetchImpl, anilistId, title, year) {
  const response = await jsonRequest(fetchImpl, 'https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { romaji english native } synonyms startDate { year } seasonYear } }', variables: { id: anilistId } }),
  });
  const media = response?.data?.Media;
  if (!media || media.id !== anilistId) throw new ResolutionError('REFERENCE_UNAVAILABLE', 'AniList reference unavailable');
  const officialYear = Number(media.startDate?.year || media.seasonYear);
  const officialTitles = [...Object.values(media.title || {}), ...(media.synonyms || [])];
  if (!officialYear || Number(year) !== officialYear || !matchingTitle(officialTitles, title)) {
    throw new ResolutionError('REFERENCE_MISMATCH', 'Selected title or year differs from AniList');
  }
  return { anilistId, malId: media.idMal || null, year: officialYear, titles: officialTitles };
}

// ani.zip maps catalog IDs, not streaming-site IDs. Never interpret its TVDB/AniDB IDs as provider IDs.
async function getMappings(fetchImpl, reference) {
  const data = await jsonRequest(fetchImpl, `https://api.ani.zip/mappings?anilist_id=${reference.anilistId}`);
  const map = data?.mappings;
  if (!map || Number(map.anilist_id) !== reference.anilistId ||
      (reference.malId && map.mal_id && Number(map.mal_id) !== reference.malId)) {
    throw new ResolutionError('MAPPING_MISMATCH', 'ani.zip mapping differs from AniList');
  }
  return map;
}

function createStreamingResolver({ fetchImpl = fetch, providers = {}, order = PROVIDERS, providerTimeoutMs = 6000, verifyStreams = false, trackProbe = null } = {}) {
  const references = new Map();
  const mappings = new Map();
  function cached(map, key, load) {
    const hit = map.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const promise = load().catch(error => { if (map.get(key)?.promise === promise) map.delete(key); throw error; });
    map.set(key, { promise, expires: Date.now() + 5 * 60 * 1000 });
    if (map.size > 100) map.delete(map.keys().next().value);
    return promise;
  }
  const referenceFor = (fetcher, id, title, year) => cached(references, `${id}|${normalizeTitle(title)}|${year}`, () => getReference(fetcher, id, title, year));
  const mappingsFor = (fetcher, reference) => cached(mappings, String(reference.anilistId), () => getMappings(fetcher, reference));
  async function listEpisodes({ anilistId, title, year, mode = 'sub' }, { signal } = {}) {
    const id = positiveId(anilistId, 'AniList ID');
    if (!['sub', 'dub'].includes(mode) || !title || !Number.isSafeInteger(Number(year))) throw new ResolutionError('INVALID_INPUT', 'Invalid episode request');
    const requestFetch = (url, options = {}) => fetchImpl(url, { ...options, signal: signal ? (options.signal ? AbortSignal.any([signal, options.signal]) : signal) : options.signal });
    const reference = await referenceFor(requestFetch, id, title, year);
    let completed = 0;
    // HiAnime's episode list is shared by Sub and Dub; only its server list proves a mode exists.
    const available = await Promise.all(order.filter(name => name !== 'HiAnime' && PROVIDERS.includes(name) && providers[name]?.episodes).map(async name => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), providerTimeoutMs);
      const providerSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const providerFetch = (url, options = {}) => fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([providerSignal, options.signal]) : providerSignal });
      try {
        const found = await Promise.race([
          (async () => {
            const candidates = await providers[name].lookup({ reference, mode, fetchImpl: providerFetch });
            const candidate = (Array.isArray(candidates) ? candidates : [candidates]).find(item => item?.id && verifiedCandidate(reference, item));
            if (!candidate) return [];
            return await providers[name].episodes({ candidate, mode, fetchImpl: providerFetch });
          })(),
          new Promise(resolve => providerSignal.addEventListener('abort', () => resolve([]), { once: true })),
        ]);
        completed++;
        return (Array.isArray(found) ? found : []).map(episodeNumber).filter(Number.isSafeInteger);
      } catch { return []; }
      finally { clearTimeout(timer); controller.abort(); }
    }));
    signal?.throwIfAborted();
    if (!completed) throw new ResolutionError('SOURCE_ERROR', 'Episode sources unavailable');
    return { mode, episodes: [...new Set(available.flat())].sort((a, b) => a - b) };
  }
  async function resolve({ anilistId, title, year, episode, mode = 'sub', audioLang = '', excludeProviders = [] }, { signal, collectAll = false } = {}) {
    signal?.throwIfAborted();
    const requestFetch = (url, options = {}) => fetchImpl(url, { ...options, signal: signal ? (options.signal ? AbortSignal.any([signal, options.signal]) : signal) : options.signal });
    const id = positiveId(anilistId, 'AniList ID');
    const number = positiveId(episode, 'episode');
    if (!['sub', 'dub'].includes(mode)) throw new ResolutionError('INVALID_INPUT', 'Invalid audio mode');
    if (!title || !Number.isSafeInteger(Number(year))) throw new ResolutionError('INVALID_INPUT', 'Title and year are required');
    const reference = await referenceFor(requestFetch, id, title, year);
    let mappings = null;
    try { mappings = await mappingsFor(requestFetch, reference); }
    catch { /* Optional catalog mapping must not prevent provider search. */ }
    const attempts = [];
    const tasks = order.map(async name => {
      signal?.throwIfAborted();
      if (!PROVIDERS.includes(name) || excludeProviders.includes(name)) return null;
      const provider = providers[name];
      if (!provider) return null;
      const controller = new AbortController();
      let timer;
      const providerSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      const providerFetch = (url, options = {}) => fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([providerSignal, options.signal]) : providerSignal });
      try {
        const result = await Promise.race([(async () => {
        // A provider must supply a page ID and independently observed title and release year.
        const found = await provider.lookup({ reference, mappings, mode, fetchImpl: providerFetch });
        const candidate = (Array.isArray(found) ? found : [found]).filter((item) => item?.id && verifiedCandidate(reference, item))
          .sort((a, b) => titleScore(reference.titles, b.titles || b.title) - titleScore(reference.titles, a.titles || a.title))[0];
        if (!candidate) { attempts.push({ provider: name, code: found && (!Array.isArray(found) || found.length) ? 'METADATA_MISMATCH' : 'NOT_FOUND' }); return null; }
        const episodeEntry = provider.episodes ? chooseEpisode(await provider.episodes({ candidate, fetchImpl: providerFetch }), number, title) : null;
        if (provider.episodes && !episodeEntry) { attempts.push({ provider: name, code: 'EPISODE_UNAVAILABLE' }); return null; }
        const streams = await provider.episode({ candidate, episode: number, episodeEntry, mode, fetchImpl: providerFetch });
        const inspected = await Promise.all((Array.isArray(streams) ? streams : [streams]).map(async (item) => {
          const clean = cleanStream(item);
          if (!clean || clean.mode !== mode) return null;
          if (verifyStreams) {
            try {
              const response = await providerFetch(clean.url, { headers: { Referer: clean.referer || new URL(clean.url).origin + '/', 'User-Agent': require('./mediaProxy.cjs').USER_AGENT, ...(clean.type === 'mp4' ? { Range: 'bytes=0-1' } : {}) } });
              if (!response.ok) { await response.body?.cancel(); return null; }
              if (clean.type === 'hls') {
                const text = await response.text();
                if (!text.trimStart().startsWith('#EXTM3U')) return null;
                const height = Math.max(0, ...[...text.matchAll(/RESOLUTION=\d+x(\d+)/g)].map(m => Number(m[1])));
                const tracks = hlsLanguages(text);
                return { ...clean, audioLanguages: [...new Set([...(clean.audioLanguages || []), ...tracks.audioLanguages])], subtitleLanguages: [...new Set([...(clean.subtitleLanguages || []), ...tracks.subtitleLanguages])], ...(height ? { height, label: height + 'p' } : {}) };
              }
              const type = response.headers.get('content-type') || '';
              await response.body?.cancel();
              return /text\/html|application\/json/i.test(type) ? null : clean;
            } catch { return null; }
          }
          return inspectHlsQuality(clean, providerFetch);
        }));
        const sources = rankedStreams(inspected);
        if (audioLang && audioLang !== 'auto') sources.sort((a, b) => Number([b.audioLanguage, ...(b.audioLanguages || [])].some(lang => String(lang || '').toLowerCase().split('-')[0] === audioLang)) - Number([a.audioLanguage, ...(a.audioLanguages || [])].some(lang => String(lang || '').toLowerCase().split('-')[0] === audioLang)));
        const stream = sources[0];
        if (!stream) { attempts.push({ provider: name, code: 'EPISODE_UNAVAILABLE' }); return null; }
        const artwork = safeMediaUrl(episodeEntry?.thumbnail || episodeEntry?.image || candidate.banner || candidate.cover);
        return { provider: name, anilistId: id, episode: number, mode, stream, sources, ...(artwork ? { artwork } : {}), attempts };
        })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ResolutionError('TIMEOUT', 'Source timed out')); }, providerTimeoutMs); })]);
        signal?.throwIfAborted();
        if (result) {
          if (trackProbe) {
            result.sources = await Promise.all(result.sources.map(async source => {
              try {
                const tracks = await trackProbe(source);
                return cleanStream({ ...source,
                  audioLanguages: [...(source.audioLanguages || []), ...(tracks?.audioLanguages || [])],
                  subtitleLanguages: [...(source.subtitleLanguages || []), ...(tracks?.subtitleLanguages || [])] });
              } catch { return source; }
            }));
            result.stream = result.sources[0];
          }
          return { ...result, attempts: [...attempts] };
        }
      } catch (error) {
        signal?.throwIfAborted();
        attempts.push({ provider: name, code: error.code || 'SOURCE_ERROR' });
      } finally { clearTimeout(timer); controller.abort(); }
      return null;
    });
    if (collectAll) {
      const results = (await Promise.all(tasks)).filter(Boolean);
      signal?.throwIfAborted();
      if (results.length) {
        const sources = results.flatMap(result => result.sources.map(source => ({ ...source, provider: result.provider })));
        return { ...results[0], sources, stream: sources[0], attempts: [...attempts] };
      }
    }
    try { if (!collectAll) return await Promise.any(tasks.map(task => task.then(result => result || Promise.reject(new Error('Unavailable'))))); }
    catch { signal?.throwIfAborted(); }
    const code = attempts.some((item) => item.code === 'METADATA_MISMATCH') ? 'METADATA_MISMATCH' : 'NO_STREAM';
    throw new ResolutionError(code, code === 'METADATA_MISMATCH' ? 'Streaming source metadata did not match AniList' : 'No verified stream is available', attempts);
  }
  return { resolve, listEpisodes };
}

module.exports = { createStreamingResolver, ResolutionError, PROVIDERS, normalizeTitle, matchingTitle, titleScore, chooseEpisode, verifiedCandidate, cleanStream, rankedStreams };
