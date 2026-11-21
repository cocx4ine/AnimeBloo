'use strict';

// Warm only a bounded opening of a stream. All URLs are rewritten proxy URLs.
async function warmMedia(source, read, signal) {
  const check = () => signal?.throwIfAborted();
  const attributes = line => Object.fromEntries([...line.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,\r\n]*))/g)].map(m => [m[1], m[2] ?? m[3]]));
  async function playlist(url, depth = 0) {
    check();
    if (depth > 3) throw new Error('Nested playlist limit');
    const response = await read(url, null, signal);
    const text = await response.text();
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid playlist');
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] && !lines[i + 1].startsWith('#')) variants.push({ ...attributes(lines[i]), url: lines[i + 1] });
    }
    if (variants.length) {
      const variant = variants.sort((a, b) => Number(b.BANDWIDTH || 0) - Number(a.BANDWIDTH || 0))[0];
      await playlist(variant.url, depth + 1);
      const audio = lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(attributes)
        .filter(item => item.TYPE === 'AUDIO' && item['GROUP-ID'] === variant.AUDIO && item.URI);
      const track = audio.find(item => item.DEFAULT === 'YES') || audio[0];
      if (track) await playlist(track.URI, depth + 1);
      return;
    }
    let segments = 0, byteRange = null, offset = 0;
    const resources = new Set();
    for (const line of lines) {
      check();
      if (/^#EXT-X-(KEY|MAP):/.test(line)) {
        const item = attributes(line);
        if (item.URI && !resources.has(item.URI)) {
          resources.add(item.URI);
          const [length, start = '0'] = (item.BYTERANGE || '').split('@');
          const range = length ? `bytes=${Number(start)}-${Number(start) + Number(length) - 1}` : null;
          await (await read(item.URI, range, signal)).arrayBuffer();
        }
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) byteRange = line.slice(17);
      else if (!line.startsWith('#')) {
        let range = null;
        if (byteRange) {
          const [length, start] = byteRange.split('@').map(Number);
          offset = Number.isFinite(start) ? start : offset;
          range = `bytes=${offset}-${offset + length - 1}`;
          offset += length;
        }
        await (await read(line, range, signal)).arrayBuffer();
        byteRange = null;
        if (++segments >= 2) break;
      }
    }
  }
  if (source.type === 'hls') await playlist(source.url);
  else {
    const response = await read(source.url, 'bytes=0-2097151', signal);
    await response.arrayBuffer();
    const total = Number(response.headers.get('content-range')?.split('/')[1]);
    // MP4 files without faststart keep their moov metadata at the end.
    if (total > 2097152) await (await read(source.url, `bytes=${Math.max(2097152, total - 524288)}-${total - 1}`, signal)).arrayBuffer();
  }
}
module.exports = { warmMedia };
