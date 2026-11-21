'use strict';

// Provider protocol adapted from AnimeDesk. Provider identity stays in this module.
const cheerio = require('cheerio');
const ORIGIN = 'https://hianime.at/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function request(fetchImpl, url, referer = ORIGIN) {
  const target = new URL(url, ORIGIN);
  if (target.protocol !== 'https:' || !['hianime.at', 'zokoanime.video'].includes(target.hostname)) throw Error('Unsupported provider host');
  const response = await fetchImpl(target.href, { headers: { 'User-Agent': UA, Referer: referer, Accept: 'application/json,text/html,*/*' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw Error(`Provider HTTP ${response.status}`);
  return response.text();
}
async function payload(fetchImpl, url) {
  const body = await request(fetchImpl, url);
  try { return JSON.parse(body).html || ''; } catch { return body; }
}

const provider = {
  async lookup({ reference, fetchImpl }) {
    const aliases = new Set(reference.titles.map(normalize));
    for (const title of reference.titles.filter(Boolean).slice(0, 8)) {
      const $ = cheerio.load(await request(fetchImpl, `${ORIGIN}search?keyword=${encodeURIComponent(title)}`));
      const hits = new Map();
      $('h3.film-name a[href]').each((_, element) => {
        const link = $(element), name = link.attr('title') || link.text();
        const slug = new URL(link.attr('href'), ORIGIN).pathname.replace(/^\//, '');
        if (aliases.has(normalize(name)) && /^[a-z0-9-]+-\d+$/i.test(slug)) hits.set(slug, name);
      });
      if (hits.size > 1) throw Error('Multiple anime matches');
      if (hits.size === 1) {
        const [id, name] = hits.entries().next().value;
        const detail = await request(fetchImpl, `${ORIGIN}${id}`);
        const $detail = cheerio.load(detail);
        const year = Number($detail('.item-title').filter((_, e) => /aired|release/i.test($detail(e).text())).first().parent().text().match(/\b(?:19|20)\d{2}\b/)?.[0] || detail.match(/(?:Aired|Released|Release Date)[^<]{0,100}(?:<[^>]+>[^<]*){0,3}?\b((?:19|20)\d{2})\b/i)?.[1]);
        if (year !== reference.year) continue;
        return { id, title: name, year };
      }
    }
    return null;
  },
  async episodes({ candidate, fetchImpl }) {
    const showId = candidate.id.match(/-(\d+)$/)?.[1];
    if (!showId) return [];
    const $ = cheerio.load(await payload(fetchImpl, `${ORIGIN}api/theme/episode/list/${showId}`));
    return $('.ep-item').toArray().map(element => ({ number: Number($(element).attr('data-number')), id: $(element).attr('data-id') })).filter(item => Number.isSafeInteger(item.number) && item.number > 0 && /^\d+$/.test(item.id || ''));
  },
  async episode({ episodeEntry, mode, fetchImpl }) {
    const $ = cheerio.load(await payload(fetchImpl, `${ORIGIN}api/theme/episode/servers?episodeId=${episodeEntry.id}`));
    const target = $('.server-item').toArray().find(element => $(element).attr('data-type') === mode && $(element).attr('data-server-name') === 'ZokoAnime');
    if (!target) return [];
    const embed = Buffer.from($(target).attr('data-hash') || '', 'base64').toString('utf8');
    const url = new URL(embed);
    if (url.protocol !== 'https:' || url.hostname !== 'zokoanime.video') throw Error('Unsupported video server');
    const html = await request(fetchImpl, embed);
    const blob = html.match(/window\.__P\s*=\s*"([^"]+)"/i)?.[1];
    if (!blob) return [];
    const input = Buffer.from(blob, 'base64'), key = Buffer.from('otaku-embed-v1');
    const decoded = Buffer.alloc(input.length);
    for (let i = 0; i < input.length; i++) decoded[i] = input[i] ^ key[i % key.length];
    const info = JSON.parse(decoded.toString('utf8'));
    const stream = typeof info.src === 'string' ? info.src : info.sources?.[0]?.src || info.file;
    if (!/^https:\/\//i.test(stream || '') || !/\.m3u8(?:[?#]|$)/i.test(stream)) return [];
    const subtitles = (Array.isArray(info.subtitles) ? info.subtitles : []).map(track => ({
      url: track.src || track.file || track.url,
      language: track.lang || track.language || track.label || 'Unknown',
      default: !!track.default,
    })).filter(track => /^https:\/\//i.test(track.url || ''));
    return [{ url: stream, type: 'hls', referer: url.origin + '/', mode, subtitles }];
  },
};

module.exports = { provider };
