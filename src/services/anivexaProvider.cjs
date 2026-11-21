'use strict';

const BASE = 'https://lvrcdn2.rewcrew.lv';
const SOURCES = Object.freeze(['animedunya', 'anikoto', 'animegg', 'anineko', 'kaa']);

async function request(fetchImpl, path) {
  const response = await fetchImpl(BASE + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  return response.json();
}

function episodeRows(data, mode) {
  const rows = new Map();
  for (const source of SOURCES) {
    for (const item of data?.[source]?.episodes?.[mode] || []) {
      const number = Number(item.number);
      if (Number.isSafeInteger(number) && number > 0) {
        if (!rows.has(number)) rows.set(number, { number, sources: [] });
        rows.get(number).sources.push(source);
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.number - b.number);
}

module.exports = { episodeRows, provider: {
  async lookup({ reference }) {
    return { id: reference.anilistId, anilistId: reference.anilistId, title: reference.titles[0], year: reference.year };
  },
  async episodes({ candidate, mode, fetchImpl }) {
    return episodeRows(await request(fetchImpl, `/episodes/${SOURCES.join('/')}/${candidate.id}`), mode);
  },
  async episode({ candidate, episodeEntry, mode, fetchImpl }) {
    const results = await Promise.allSettled((episodeEntry.sources || []).filter(source => SOURCES.includes(source)).map(source => request(fetchImpl, `/watch/${source}/${candidate.id}/${mode}/${source}-${episodeEntry.number}`)));
    return results.filter(result => result.status === 'fulfilled' && (!result.value?.audio || result.value.audio === mode)).flatMap(result => (Array.isArray(result.value?.streams) ? result.value.streams : [])).filter(item => item?.isActive !== false && ['hls', 'mp4'].includes(String(item?.type).toLowerCase())).map(item => ({
      url: item.url, type: String(item.type).toLowerCase(), mode,
      audioLanguage: item.audioLanguage || item.audio_lang || item.language || undefined,
      referer: item.referer || item.headers?.Referer,
      subtitles: (Array.isArray(item.subtitles) ? item.subtitles : []).map(track => ({ url: track.url, language: track.srclang || track.label || '', default: !!track.default })),
      quality: item.quality,
    }));
  },
} };
