'use strict';
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { warmMedia } = require('./mediaPrefetch.cjs');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36';
function remoteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|.*\.localhost|\[|\d+\.\d+\.\d+\.\d+$)/i.test(url.hostname)) throw new Error('Invalid media URL');
  return url.href;
}
function createMediaProxy({ fetchImpl = fetch } = {}) {
  const entries = new Map();
  const urls = new Map();
  const cache = new Map();
  const prefetchToken = randomBytes(24).toString('hex');
  const active = new Set();
  const maxCacheBytes = 32 * 1024 * 1024;
  const maxEntryBytes = 8 * 1024 * 1024;
  let cacheBytes = 0, revision = 0;
  let origin;
  function clearCache() { cache.clear(); cacheBytes = 0; revision++; }
  function remember(key, item) {
    const old = cache.get(key);
    if (old) cacheBytes -= old.body.length;
    cache.delete(key);
    while (cacheBytes + item.body.length > maxCacheBytes && cache.size) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).body.length;
      cache.delete(oldest);
    }
    cache.set(key, { ...item, expires: Date.now() + 5 * 60 * 1000 });
    cacheBytes += item.body.length;
  }
  function cached(entry, req, res) {
    for (const [key, item] of cache) {
      if (item.expires < Date.now()) { cache.delete(key); cacheBytes -= item.body.length; continue; }
      if (item.url !== entry.url || item.referer !== entry.referer) continue;
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      let start = 0, end = item.total - 1;
      if (req.headers.range && !range) continue;
      if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), item.total - 1) : Math.min(item.end, item.total - 1); }
      if (start < item.start || end > item.end || end < start || (!range && item.status !== 200)) continue;
      const body = item.body.subarray(start - item.start, end - item.start + 1);
      res.setHeader('Content-Type', item.type);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', body.length);
      if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${item.total}`);
      res.writeHead(range ? 206 : 200);
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    }
    return false;
  }
  function register(url, referer) {
    url = remoteUrl(url);
    referer = remoteUrl(referer || new URL(url).origin + '/');
    const key = `${referer}|${url}`;
    if (urls.has(key)) return urls.get(key);
    const token = randomBytes(24).toString('hex');
    const local = `${origin}/media/${token}`;
    entries.set(token, { url, referer }); urls.set(key, local);
    return local;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const entry = entries.get(req.url?.split('/').pop());
    if (!entry || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    if (cached(entry, req, res)) return;
    const warming = req.headers['x-animebloo-prefetch'] === prefetchToken;
    const requestRevision = revision;
    const controller = new AbortController();
    active.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    res.on('close', () => controller.abort());
    try {
      let url = entry.url, upstream;
      const headers = { 'Accept-Encoding': 'identity', 'User-Agent': USER_AGENT, Referer: entry.referer, Origin: new URL(entry.referer).origin };
      if (req.headers.range) headers.Range = req.headers.range;
      for (let redirects = 0; redirects <= 5; redirects++) {
        upstream = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'manual', method: req.method });
        if (![301,302,303,307,308].includes(upstream.status)) break;
        await upstream.body?.cancel();
        url = remoteUrl(new URL(upstream.headers.get('location'), url).href);
        if (redirects === 5) throw new Error('Too many redirects');
      }
      if (!upstream.ok) {
        for (const name of ['content-range','accept-ranges']) { const value = upstream.headers.get(name); if (value) res.setHeader(name, value); }
        await upstream.body?.cancel(); res.writeHead(upstream.status); res.end(); return;
      }
      const type = upstream.headers.get('content-type') || '';
      if (req.method === 'HEAD') {
        for (const name of ['content-type','content-length','content-range','accept-ranges']) {
          const value = upstream.headers.get(name); if (value) res.setHeader(name, value);
        }
        res.writeHead(upstream.status); res.end(); return;
      }
      if (/mpegurl/i.test(type) || /\.m3u8(?:$|\?)/i.test(url)) {
        const text = await upstream.text();
        if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid playlist');
        const rewritten = text.split(/\r?\n/).map(line => {
          if (!line.trim()) return line;
          if (!line.startsWith('#')) return register(new URL(line.trim(), url).href, entry.referer);
          return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${register(new URL(uri, url).href, entry.referer)}"`);
        }).join('\n');
        res.setHeader('Content-Type','application/vnd.apple.mpegurl');
        res.end(req.method === 'HEAD' ? undefined : rewritten);
      } else {
        if (warming && req.method === 'GET') {
          const chunks = []; let length = 0;
          if (Number(upstream.headers.get('content-length')) > maxEntryBytes) throw new Error('Prefetch entry limit');
          for await (const chunk of Readable.fromWeb(upstream.body)) {
            length += chunk.length;
            if (length > maxEntryBytes) throw new Error('Prefetch entry limit');
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          const match = upstream.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (requestRevision === revision && (upstream.status === 200 || (match && Number(match[2]) - Number(match[1]) + 1 === length))) {
            remember(`${entry.url}|${entry.referer}|${req.headers.range || ''}`, { ...entry, body, type, status: upstream.status,
              start: match ? Number(match[1]) : 0, end: match ? Number(match[2]) : length - 1, total: match ? Number(match[3]) : length });
          }
          for (const name of ['content-type','content-range','accept-ranges']) { const value = upstream.headers.get(name); if (value) res.setHeader(name, value); }
          res.setHeader('Content-Length', length); res.writeHead(upstream.status); res.end(body);
          return;
        }
        clearTimeout(timeout);
        for (const name of ['content-type','content-length','content-range','accept-ranges']) {
          const value = upstream.headers.get(name); if (value) res.setHeader(name,value);
        }
        res.writeHead(upstream.status);
        if (req.method === 'HEAD' || !upstream.body) res.end();
        else await pipeline(Readable.fromWeb(upstream.body),res);
      }
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
    finally { clearTimeout(timeout); active.delete(controller); }
  });
  return {
    async start() { await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); }); origin = `http://127.0.0.1:${server.address().port}`; },
    wrap(source) { return { ...source, url: register(source.url, source.referer), ...(source.subtitles ? { subtitles: source.subtitles.map(track => ({ ...track, url: register(track.url, source.referer) })) } : {}) }; },
    clearCache,
    async prefetch(source, { signal } = {}) {
      const read = async (url, range, requestSignal) => {
        if (!url.startsWith(`${origin}/media/`) || !entries.has(url.split('/').pop())) throw new Error('Invalid prefetch URL');
        const response = await fetch(url, { headers: { 'X-AnimeBloo-Prefetch': prefetchToken, ...(range ? { Range: range } : {}) }, signal: requestSignal });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Prefetch unavailable'); }
        return response;
      };
      await warmMedia(source, read, signal);
    },
    clear() { clearCache(); for (const controller of active) controller.abort(); entries.clear(); urls.clear(); },
    close() { this.clear(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); },
  };
}
module.exports = { createMediaProxy, USER_AGENT };
