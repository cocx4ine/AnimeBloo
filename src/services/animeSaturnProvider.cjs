'use strict';

const BASE = 'https://www.animesaturn.su';

async function request(fetchImpl, url, json = false) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`AnimeSaturn HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function decode(value) {
  return String(value || '').replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<[^>]*>/g, '').trim();
}

function searchResults(html) {
  const results = [];
  const cards = html.split(/<div class="flex items-start gap-3 px-3 py-2\.5/).slice(1);
  for (const card of cards) {
    const url = card.match(/href="(https:\/\/www\.animesaturn\.su\/anime\/[^"]+)"/)?.[1];
    const title = decode(card.match(/<p class="text-sm font-medium[^>]*>([^<]+)<\/p>/)?.[1]);
    const year = Number(card.match(/Year:<\/span>\s*(\d{4})/)?.[1]);
    if (url && title && year) results.push({ id: url, title, year, isDub: /\b(?:ita|dub)\b/i.test(`${url} ${title}`) });
  }
  return results;
}

function episodeLinks(html) {
  const results = [];
  const pattern = /<a href="(https:\/\/www\.animesaturn\.su\/episode\/[^"]+)" class="ep-tile" title="Episodio\s+(\d+)"/g;
  for (const match of html.matchAll(pattern)) results.push({ number: Number(match[2]), url: match[1] });
  return results;
}

function playerUrl(html) {
  const escaped = html.match(/initialVideoUrl&quot;:&quot;([^&]+)&quot;/)?.[1];
  return escaped?.replace(/\\\//g, '/') || null;
}

module.exports = {
  searchResults, episodeLinks, playerUrl,
  provider: {
    async lookup({ reference, mode, fetchImpl }) {
      const results = [];
      for (const title of reference.titles.filter(Boolean).slice(0, 3)) {
        const data = await request(fetchImpl, `${BASE}/wp-admin/admin-ajax.php?action=animesaturn_live_search&q=${encodeURIComponent(title)}`, true);
        results.push(...searchResults(data?.html || '').filter(item => item.isDub === (mode === 'dub')));
        if (results.some((item) => item.year === reference.year)) break;
      }
      return results;
    },
    async episodes({ candidate, fetchImpl }) {
      return episodeLinks(await request(fetchImpl, candidate.id));
    },
    async episode({ episodeEntry, mode, fetchImpl }) {
      const page = await request(fetchImpl, episodeEntry.url);
      const wrapper = playerUrl(page);
      if (!wrapper || !wrapper.startsWith(`${BASE}/wp-content/themes/animesaturn-theme/player/source/`)) return null;
      const wrapperHtml = await request(fetchImpl, wrapper);
      const embed = wrapperHtml.match(/<iframe\s+src="(https:\/\/cdn2\.megaplay\.su\/e\/[^"]+)"/)?.[1];
      if (!embed) return null;
      const embedHtml = await request(fetchImpl, embed);
      const hls = embedHtml.match(/var primary\s*=\s*"(https:\/\/cdn2\.megaplay\.su\/hls\/[^"\s]+\.m3u8)"/)?.[1];
      return hls ? { url: hls, type: 'hls', referer: embed, mode } : null;
    },
  },
};
