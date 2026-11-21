'use strict';
const cheerio = require('cheerio');

const BASE = 'https://www.animeworld.ac';

async function request(fetchImpl, url, json = false) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`AnimeWorld HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, '').trim();
}

function searchResults(html) {
  const results = [];
  const $ = cheerio.load(html);
  $('.film-list a.name[href^="/play/"], .item a.name[href^="/play/"]').each((_, element) => {
    const link = $(element);
    const id = link.attr('href');
    const title = decode(link.text());
    const alternate = decode(link.attr('data-jtitle'));
    if (!id || !title) return;
    const year = Number(alternate.match(/\((\d{4})\)/)?.[1] || id.match(/(?:^|-)(\d{4})(?:\.|$)/)?.[1]);
    results.push({ id, title: alternate.replace(/\s*\(\d{4}\)\s*$/, '') || title, titles: [title, alternate.replace(/\s*\(\d{4}\)\s*$/, '')], year, isDub: /\b(?:ita|dub)\b/i.test(`${id} ${title} ${alternate}`) });
  });
  if (results.length) return results;
  const pattern = /<a\s+href="(\/play\/[^"/]+)"\s+data-jtitle="([^"]+)"\s+class="name">([^<]+)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const year = Number(match[2].match(/\((\d{4})\)/)?.[1] || match[1].match(/(?:^|-)(\d{4})(?:\.|$)/)?.[1]);
    results.push({ id: match[1], title: decode(match[2]).replace(/\s*\(\d{4}\)\s*$/, ''), titles: [decode(match[2]).replace(/\s*\(\d{4}\)\s*$/, ''), decode(match[3])], year, isDub: /\b(?:ita|dub)\b/i.test(`${match[1]} ${match[2]} ${match[3]}`) });
  }
  return results;
}

function episodeLinks(html) {
  const results = [];
  const $ = cheerio.load(html);
  $('.episode a[data-num][data-id]').each((_, element) => {
    const link = $(element), number = Number(link.attr('data-num')), id = link.attr('data-id');
    if (Number.isSafeInteger(number) && number > 0 && /^[a-z0-9_-]+$/i.test(id || '')) results.push({ number, id, url: new URL(link.attr('href'), BASE).href });
  });
  if (results.length) return results;
  const pattern = /<a\b[^>]*data-episode-num="(\d+)"[^>]*href="(\/play\/[^"]+)"[^>]*>/g;
  for (const match of html.matchAll(pattern)) results.push({ number: Number(match[1]), url: `${BASE}${match[2]}`, token: match[2].split('/').pop() });
  return results;
}

module.exports = {
  searchResults,
  episodeLinks,
  provider: {
    async lookup({ reference, mode, fetchImpl }) {
      const results = [];
      for (const title of reference.titles.filter(Boolean).slice(0, 3)) {
        const html = await request(fetchImpl, `${BASE}/search?keyword=${encodeURIComponent(title)}`);
        const { titleScore } = require('./streamingResolver.js');
        const found = searchResults(html).filter(item => item.isDub === (mode === 'dub') && titleScore(reference.titles,item.titles) >= 0.8).slice(0,4);
        await Promise.all(found.map(async item => {
          if (!item.year) {
            const detail = await request(fetchImpl, new URL(item.id,BASE).href);
            item.year = Number(detail.match(/\/filter\?season=[^"&]+(?:&amp;|&)year=(\d{4})/)?.[1] || detail.match(/<dt>Data di Uscita:<\/dt>\s*<dd>[^<]*(\d{4})<\/dd>/)?.[1]);
          }
          results.push(item);
        }));
        if (results.some((item) => item.year === reference.year)) break;
      }
      return results;
    },
    async episodes({ candidate, fetchImpl }) {
      return episodeLinks(await request(fetchImpl, `${BASE}${candidate.id}`));
    },
    async episode({ episodeEntry, mode, fetchImpl }) {
      const page = await request(fetchImpl, episodeEntry.url);
      const csrf = page.match(/window\.csrfToken\s*=\s*["']([^"']+)["']/)?.[1];
      const response = await fetchImpl(`${BASE}/api/episode/info?id=${encodeURIComponent(episodeEntry.id || episodeEntry.token)}&alt=0`, { headers: { Referer: episodeEntry.url, 'X-Requested-With': 'XMLHttpRequest', ...(csrf ? { 'CSRF-Token': csrf } : {}) }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`AnimeWorld HTTP ${response.status}`);
      const data = await response.json();
      const candidates = [...(Array.isArray(data?.grabber) ? data.grabber : [data?.grabber]), ...(Array.isArray(data?.sources) ? data.sources : [])];
      return candidates.flatMap((item) => {
        if (!item) return [];
        const url = typeof item === 'string' ? item : item.url || item.file || item.src;
        if (!url) return [];
        return [{ url, type: /\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : /iframe|embed/i.test(item.type || '') ? 'embed' : 'mp4', referer: episodeEntry.url, quality: item.quality || item.label || item.resolution, mode }];
      });
    },
  },
};
