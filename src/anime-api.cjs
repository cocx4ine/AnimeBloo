// Response caches for the four API providers. User preferences and library data
// live outside these maps and are never touched by clearCache().
const anilist = new Map();
const aniZip = new Map();
const kitsu = new Map();
const jikan = new Map();

const providers = Object.freeze({ anilist, aniZip, kitsu, jikan });

function cacheFor(provider) {
  const cache = providers[provider];
  if (!cache) throw new RangeError('Unsupported anime API provider');
  return cache;
}

module.exports = {
  get: (provider, key) => cacheFor(provider).get(key),
  set: (provider, key, value) => cacheFor(provider).set(key, value),
  clearCache: () => {
    anilist.clear();
    aniZip.clear();
    kitsu.clear();
    jikan.clear();
  },
};
