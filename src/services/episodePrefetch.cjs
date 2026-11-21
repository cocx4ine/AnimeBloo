'use strict';

function createEpisodePrefetch({ resolver, proxy }) {
  let active = null;
  function cancel() { active?.abort(); active = null; }
  async function prepare(request) {
    cancel();
    const controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
    try {
      const result = await resolver.resolve(request, { signal });
      signal.throwIfAborted();
      result.sources = result.sources.map(source => proxy.wrap(source));
      result.stream = result.sources[0];
      // Resolution is immediately reusable; warming never delays a manual next.
      void (async () => {
        for (const source of result.sources) {
          if (signal.aborted) break;
          try { await proxy.prefetch(source, { signal }); break; }
          catch { /* Try the next verified mirror silently. */ }
        }
      })().catch(() => {});
      return { status: 'ok', result };
    } catch {
      return { status: 'error' };
    }
  }
  return { prepare, cancel };
}
module.exports = { createEpisodePrefetch };
