'use strict';
const BASE = 'https://animeunity.co';
async function request(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
function pageProps(html) {
  const raw = html.match(/data-page="([^"]+)"/)?.[1];
  return raw ? JSON.parse(raw.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#039;/g,"'")).props : {};
}
function directSources(html, referer) {
  const decoded = html.replace(/&amp;/g, '&').replace(/\\\//g, '/');
  return [...decoded.matchAll(/https:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi)]
    .map(match => ({ url: match[0], type: match[0].includes('.m3u8') ? 'hls' : 'mp4', referer }));
}
function playlistSources(html, referer) {
  const block = html.match(/window\.masterPlaylist\s*=\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  // Read values only; never evaluate third-party JavaScript.
  const base = html.match(/window\.masterPlaylist\s*=\s*\{[\s\S]*?\burl:\s*['"]([^'"]+)/)?.[1];
  if (!base) return directSources(html, referer);
  const params = Object.fromEntries([...block.matchAll(/['"](token|expires|asn)['"]:\s*['"]([^'"]*)/g)].map(m=>[m[1],m[2]]));
  const streams = html.match(/window\.streams\s*=\s*(\[[^;]+\]);/)?.[1];
  let mirrors = []; try { mirrors = streams ? JSON.parse(streams) : []; } catch {}
  return (mirrors.length ? mirrors : [{url:base}]).map(item=>{
    const url = new URL(item.url);
    for (const [key,value] of Object.entries(params)) if(value) url.searchParams.set(key,value);
    if (/window\.canPlayFHD\s*=\s*true/.test(html)) url.searchParams.set('h', '1');
    return {url:url.href,type:'hls',referer};
  });
}
module.exports = { directSources, pageProps, playlistSources, provider: {
  async lookup({ reference, fetchImpl }) {
    for (const title of reference.titles.filter(Boolean).slice(0,3)) {
      const data = await (await request(fetchImpl, `${BASE}/api/search?q=${encodeURIComponent(title)}`)).json();
      const found = (data.data || []).map(item => ({ id:item.id,slug:item.slug,title:item.title,titles:[item.title,item.title_ja,item.title_it],year:Number(item.year),anilistId:item.anilist_id,malId:item.mal_id }));
      if (found.some(item=>item.year===reference.year)) return found;
    }
    return [];
  },
  async episodes({ candidate, mode, fetchImpl }) {
    const data = await (await request(fetchImpl, `${BASE}/api/anime/${candidate.id}/episodes`)).json();
    const language = mode === 'dub' ? 'ita' : 'jpn';
    return (data.episodes || []).filter(item => item.videos?.some(video => video.language === language && !video.is_hidden))
      .map(item=>({...item,number:Number(item.number)}));
  },
  async episode({ candidate, episodeEntry, mode, fetchImpl }) {
    const video = episodeEntry.videos?.find(item=>item.language===(mode === 'sub' ? 'jpn' : 'ita') && !item.is_hidden);
    if (!video) return [];
    const referer = `${BASE}/anime/${candidate.id}-${candidate.slug}/${video.id}`;
    const props = pageProps(await (await request(fetchImpl,referer)).text());
    if (!props.embedUrl) return [];
    const html = await (await request(fetchImpl,props.embedUrl,{headers:{Referer:referer}})).text();
    return playlistSources(html,props.embedUrl).map(source => ({ ...source, mode, audioLanguage: video.language }));
  },
} };
