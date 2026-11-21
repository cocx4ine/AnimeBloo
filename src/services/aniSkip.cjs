// AniSkip v2 identifies series by MAL ID, never by AniList ID.
function createAniSkip({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 6000 } = {}) {
  const cache = new Map();
  function memo(key, task, ttl = 6 * 60 * 60_000) {
    const found = cache.get(key);
    if (found && found.expires > now()) return found.promise;
    if (cache.size >= 400) cache.delete(cache.keys().next().value);
    const entry = { expires: now() + ttl };
    entry.promise = Promise.resolve().then(task).catch(() => {
      entry.expires = now() + 60_000;
      return null;
    });
    cache.set(key, entry);
    return entry.promise;
  }
  async function json(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Unavailable');
    return response.json();
  }
  const validId = value => Number.isSafeInteger(value) && value > 0;
  async function getSkipTimes(input = {}) {
    const { anilistId, episode, malId, episodeLength } = input || {};
    if (!validId(anilistId) || !Number.isFinite(episode) || episode <= 0) return [];
    const length = Number.isFinite(episodeLength) && episodeLength > 0 ? Math.round(episodeLength) : 0;
    const mapped = validId(malId) ? malId : await memo(`map:${anilistId}`, async () => {
      const result = await json('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query ($id: Int) { Media(id: $id, type: ANIME) { id idMal } }', variables: { id: anilistId } }),
      });
      return result?.data?.Media?.id === anilistId ? result.data.Media.idMal : null;
    });
    if (!validId(mapped)) return [];
    const result = await memo(`times:${anilistId}:${mapped}:${episode}:${length}`, async () => {
      const params = new URLSearchParams({ episodeLength: String(length) });
      params.append('types', 'op'); params.append('types', 'ed');
      const data = await json(`https://api.aniskip.com/v2/skip-times/${mapped}/${episode}?${params}`);
      if (!data?.found || !Array.isArray(data.results)) return [];
      return data.results.flatMap(item => {
        const { startTime, endTime } = item.interval || {};
        if (!['op', 'ed'].includes(item.skipType) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime || (length && startTime >= length)) return [];
        return [{ type: item.skipType, startTime, endTime: length ? Math.min(endTime, length) : endTime }];
      }).sort((a, b) => a.startTime - b.startTime);
    });
    return result || [];
  }
  return { getSkipTimes, clear: () => cache.clear() };
}
module.exports = { createAniSkip };
