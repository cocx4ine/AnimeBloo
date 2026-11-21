'use strict';

const SITE = 'https://allanime.day/';
const SEARCH = 'query($search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name availableEpisodes}}}';
const DETAILS = 'query($showId:String!){show(_id:$showId){_id name availableEpisodesDetail airedStart}}';
const { normalizeTitle } = require('./streamingResolver.js');

function decode(value) {
  if (typeof value !== 'string') return '';
  if (!value.startsWith('--')) return value;
  const hex = value.slice(2);
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return '';
  return Buffer.from(hex, 'hex').map(byte => byte ^ 0x38).toString('utf8').replace('/clock?', '/clock.json?');
}

function direct(value) {
  return typeof value === 'string' && /^https:\/\/[^\s]+\.(?:m3u8|mp4)(?:[?#]|$)/i.test(value);
}

function collect(value, mode, depth = 0) {
  if (depth > 8 || !value) return [];
  if (typeof value === 'string') return direct(value) ? [{ url: value, type: /\.m3u8(?:[?#]|$)/i.test(value) ? 'hls' : 'mp4', mode, referer: SITE }] : [];
  if (Array.isArray(value)) return value.flatMap(item => collect(item, mode, depth + 1));
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !['thumbnail', 'image', 'poster'].includes(key)).flatMap(([, item]) => collect(item, mode, depth + 1));
  return [];
}

module.exports = { decode, collect, provider: {
  async lookup({ reference, mode }) {
    const gql = await import('./allanime-gql.mjs');
    const titles = [...new Set(reference.titles.filter(Boolean))].slice(0, 3);
    for (const title of titles) {
      const result = await gql.allAnimeGql({ search: { allowAdult: false, allowUnknown: false, query: title }, limit: 30, page: 1, translationType: mode, countryOrigin: 'ALL' }, SEARCH);
      const matches = (result?.data?.shows?.edges || []).filter(item => item?._id && reference.titles.some(expected => normalizeTitle(expected) === normalizeTitle(item.name))).slice(0, 3);
      const details = await Promise.all(matches.map(async item => {
        const found = await gql.allAnimeGql({ showId: item._id }, DETAILS);
        const show = found?.data?.show;
        return show?._id === item._id ? { id: item._id, title: show.name, year: Number(show.airedStart?.year) } : null;
      }));
      if (details.some(item => item?.year === reference.year)) return details.filter(Boolean);
    }
    return [];
  },
  async episodes({ candidate, mode }) {
    const gql = await import('./allanime-gql.mjs');
    const found = await gql.allAnimeGql({ showId: candidate.id }, DETAILS);
    return (found?.data?.show?.availableEpisodesDetail?.[mode] || []).map(Number).filter(number => Number.isSafeInteger(number) && number > 0).map(number => ({ number }));
  },
  async episode({ candidate, episodeEntry, mode, fetchImpl }) {
    const gql = await import('./allanime-gql.mjs');
    const persisted = await gql.getEpisodeEmbedPersistedQuery();
    const found = await gql.allAnimeGql({ showId: candidate.id, translationType: mode, episodeString: String(episodeEntry.number) }, persisted.query, persisted.hash);
    const sources = found?.data?.episode?.sourceUrls || [];
    const results = await Promise.all(sources.map(async item => {
      try {
        const link = decode(item.sourceUrl);
        if (direct(link)) return collect(link, mode);
        const url = new URL(link, SITE);
        if (!/(^|\.)allanime\.day$/i.test(url.hostname) || !/\.json$/i.test(url.pathname)) return [];
        const response = await fetchImpl(url.href, { headers: { Referer: SITE }, signal: AbortSignal.timeout(6000) });
        return response.ok ? collect(await response.json(), mode) : [];
      } catch { return []; }
    }));
    return results.flat();
  },
} };
