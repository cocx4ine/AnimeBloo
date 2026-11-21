const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('animeBloo', {
  initialLanguage: ipcRenderer.sendSync('language:get'),
  initialTheme: ipcRenderer.sendSync('theme:get'),
  isDevelopment: ipcRenderer.sendSync('app:is-development'),
  currentVersion: ipcRenderer.sendSync('app:version'),
  restoreAuth: () => ipcRenderer.invoke('auth:restore'),
  openAniListAuth: () => ipcRenderer.invoke('auth:open'),
  connectAniList: (token) => ipcRenderer.invoke('auth:connect', token),
  logoutAniList: () => ipcRenderer.invoke('auth:logout'),
  setLanguage: (language) => ipcRenderer.invoke('language:set', language),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  onSystemThemeChange: (callback) => {
    const listener = (_event, resolved) => callback(resolved);
    ipcRenderer.on('theme:system-changed', listener);
    return () => ipcRenderer.removeListener('theme:system-changed', listener);
  },
  getCacheSize: () => ipcRenderer.invoke('cache:size'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  searchAnime: (term) => ipcRenderer.invoke('anime:search', term),
  getAnime: (id, language) => ipcRenderer.invoke('anime:details', id, language),
  getHomeFeed: () => ipcRenderer.invoke('anime:home-feed'),
  getHomeReleaseArtwork: (releases) => ipcRenderer.invoke('anime:home-release-artwork', releases),
  toggleFavorite: (id) => ipcRenderer.invoke('anime:toggle-favorite', id),
  getBookmarks: () => ipcRenderer.invoke('bookmarks:all'),
  toggleBookmark: (category, anime) => ipcRenderer.invoke('bookmarks:toggle', category, anime),
  syncPlanning: () => ipcRenderer.invoke('bookmarks:sync-planning'),
  setPlayerFullscreen: (enabled, cleanup = false) => ipcRenderer.invoke('player:fullscreen', enabled, cleanup),
  onPlayerExit: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('player:exit', listener);
    return () => ipcRenderer.removeListener('player:exit', listener);
  },
  getSkipTimes: (request) => ipcRenderer.invoke('aniskip:times', request),
  resolveStream: (request) => ipcRenderer.invoke('stream:resolve', request),
  getStreamEpisodes: (request) => ipcRenderer.invoke('stream:episodes', request),
  discoverStreamTracks: (request) => ipcRenderer.invoke('stream:discover', request),
  prefetchStream: (request) => ipcRenderer.invoke('stream:prefetch', request),
  cancelStreamPrefetch: () => ipcRenderer.invoke('stream:cancel-prefetch'),
  getWatchHistory: () => ipcRenderer.invoke('watch:history'),
  getWatchSessions: () => ipcRenderer.invoke('watch:sessions'),
  saveWatchSession: (session) => ipcRenderer.invoke('watch:session-save', session),
  saveWatchProgress: (record) => ipcRenderer.invoke('watch:progress', record),
  saveWatchProgressSync: (record) => ipcRenderer.sendSync('watch:progress-sync', record),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  previewUpdate: () => ipcRenderer.invoke('update:preview'),
  openUpdate: (version) => ipcRenderer.invoke('update:open', version),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onMaximizedChange: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  onWindowShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('splash:start', listener);
    return () => ipcRenderer.removeListener('splash:start', listener);
  },
});
