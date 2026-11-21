const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme, session, shell } = require('electron');
const { createLanguageStore, isSupportedLanguage, isSupportedTheme } = require('./language-store.cjs');
const multiApi = require('./services/multiApi.cjs');
const { checkForUpdate, getLatestRelease, getReleaseHistory, compareVersions } = require('./update-checker.cjs');
const { ANILIST_AUTHORIZE_URL, createAuthStore, verifyToken, publicProfile } = require('./anilist-auth.cjs');
const { createStreamingResolver } = require('./services/streamingResolver.js');
const { provider: animeWorldProvider } = require('./services/animeWorldProvider.cjs');
const { provider: animeSaturnProvider } = require('./services/animeSaturnProvider.cjs');
const { provider: animeUnityProvider } = require('./services/animeUnityProvider.cjs');
const { createMediaProxy } = require('./services/mediaProxy.cjs');
const mediaProxy = createMediaProxy();
const aniSkip = require('./services/aniSkip.cjs').createAniSkip();
const { createWatchProgress } = require('./services/watchProgress.cjs');
const { createWatchHistory } = require('./services/watchHistory.cjs');
const { createBookmarks } = require('./services/bookmarks.cjs');

let mainWindow;
let updateCheck;
let availableUpdate = null;
let previewActive = false;
let releaseHistory = [];
let releaseStatusRequest;
let settingsStore;
let authStore;
let watchProgress;
let watchHistory;
let bookmarks;
let authRevision = 0;
const catalog = multiApi.createMultiApi();
const streamingResolver = createStreamingResolver({ verifyStreams: true, trackProbe: require('./services/mediaTrackProbe.cjs').probeMediaTracks, providers: { AnimeSaturn: animeSaturnProvider, AnimeWorld: animeWorldProvider, AnimeUnity: animeUnityProvider, Anivexa: require('./services/anivexaProvider.cjs').provider, AllAnime: require('./services/allAnimeProvider.cjs').provider, HiAnime: require('./services/hianimeProvider.cjs').provider } });
const episodePrefetch = require('./services/episodePrefetch.cjs').createEpisodePrefetch({ resolver: streamingResolver, proxy: mediaProxy });
const discoveredStreams = new Map();
const resolvedTheme = (mode) => mode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : mode;

function previewRelease() {
  const [major, minor, patch] = require('../package.json').version.split('.').map(Number);
  return { preview: true, version: `${major}.${minor}.${patch + 1}`, url: 'https://github.com/cayo/AnimeBloo/releases' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: resolvedTheme(settingsStore.getTheme()) === 'dark' ? '#090a0d' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.once('show', () => mainWindow.webContents.send('splash:start'));
  const sendState = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);
  mainWindow.webContents.on('did-start-loading', () => { mainWindow.setFullScreen(false); episodePrefetch.cancel(); mediaProxy.clear(); });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.webContents.send('player:exit');
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.on('closed', () => { episodePrefetch.cancel(); mediaProxy.clear(); mainWindow = null; });
}

app.whenReady().then(async () => {
  await mediaProxy.start();
  const languageStore = settingsStore = createLanguageStore(app.getPath('userData'));
  authStore = createAuthStore(app.getPath('userData'));
  watchProgress = createWatchProgress(app.getPath('userData'));
  watchHistory = createWatchHistory(app.getPath('userData'));
  bookmarks = createBookmarks(app.getPath('userData'));
  const fromMainWindow = (event) => BrowserWindow.fromWebContents(event.sender) === mainWindow;
  ipcMain.handle('auth:restore', async (event) => {
    if (!fromMainWindow(event)) return { status: 'invalid' };
    const revision = authRevision;
    const saved = authStore.get();
    if (!saved) return { status: 'missing' };
    const result = await verifyToken(saved.token);
    if (revision !== authRevision) return { status: 'missing' };
    if (result.status === 'invalid') authStore.clear();
    if (result.status !== 'ok') return { status: result.status };
    authStore.set(result.session);
    return { status: 'ok', profile: publicProfile(result.session) };
  });
  ipcMain.handle('auth:open', async (event) => {
    if (!fromMainWindow(event)) return false;
    await shell.openExternal(ANILIST_AUTHORIZE_URL);
    return true;
  });
  ipcMain.handle('auth:connect', async (event, token) => {
    if (!fromMainWindow(event)) return { status: 'invalid' };
    const revision = authRevision;
    const result = await verifyToken(token);
    if (revision !== authRevision) return { status: 'invalid' };
    if (result.status !== 'ok') return { status: result.status };
    authRevision++;
    authStore.set(result.session);
    return { status: 'ok', profile: publicProfile(result.session) };
  });
  ipcMain.handle('auth:logout', (event) => {
    if (!fromMainWindow(event)) return false;
    authRevision++;
    episodePrefetch.cancel(); mediaProxy.clear();
    authStore.clear();
    return true;
  });
  ipcMain.on('language:get', (event) => {
    event.returnValue = languageStore.get();
  });
  ipcMain.on('theme:get', (event) => {
    const mode = settingsStore.getTheme();
    event.returnValue = { mode, resolved: resolvedTheme(mode) };
  });
  ipcMain.handle('theme:set', (event, mode) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow || !isSupportedTheme(mode)) {
      throw new RangeError('Unsupported theme');
    }
    settingsStore.setTheme(mode);
    const resolved = resolvedTheme(mode);
    mainWindow.setBackgroundColor(resolved === 'dark' ? '#090a0d' : '#f6f7f9');
    return { mode, resolved };
  });
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed() || settingsStore.getTheme() !== 'system') return;
    const resolved = resolvedTheme('system');
    mainWindow.setBackgroundColor(resolved === 'dark' ? '#090a0d' : '#f6f7f9');
    mainWindow.webContents.send('theme:system-changed', resolved);
  });
  ipcMain.on('app:is-development', (event) => {
    event.returnValue = !app.isPackaged;
  });
  ipcMain.on('app:version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.handle('language:set', (event, language) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow || !isSupportedLanguage(language)) {
      throw new RangeError('Unsupported language');
    }
    return languageStore.set(language);
  });
  ipcMain.handle('cache:size', async (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) {
      throw new Error('Unauthorized cache request');
    }
    return { bytes: await session.defaultSession.getCacheSize() };
  });
  ipcMain.handle('cache:clear', async (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) {
      throw new Error('Unauthorized cache request');
    }
    await session.defaultSession.clearCache();
    // Keep cookies, localStorage and IndexedDB: they may hold user data.
    await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] });
    try { await session.defaultSession.clearCodeCaches({}); } catch { /* optional */ }
    multiApi.clearCache();
    aniSkip.clear();
    return true;
  });
  ipcMain.handle('aniskip:times', (event, request) => {
    if (!fromMainWindow(event) || !authStore.get()) return [];
    return aniSkip.getSkipTimes(request);
  });
  ipcMain.handle('anime:search', (event, term) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized catalog request');
    return catalog.searchAnime(term);
  });
  ipcMain.handle('anime:details', (event, id, language) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized catalog request');
    return catalog.getAnime(id, isSupportedLanguage(language) ? language : 'en');
  });
  ipcMain.handle('anime:home-feed', (event) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized catalog request');
    return catalog.getHomeFeed(authStore.get());
  });
  ipcMain.handle('anime:home-release-artwork', (event, releases) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized catalog request');
    return catalog.getHomeReleaseArtwork(releases);
  });
  ipcMain.handle('anime:toggle-favorite', (event, id) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized favorite request');
    return catalog.toggleFavorite(authStore.get(), id);
  });
  ipcMain.handle('bookmarks:all', (event) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized bookmarks request');
    return bookmarks.all(authStore.get());
  });
  ipcMain.handle('bookmarks:toggle', (event, category, anime) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized bookmarks request');
    return bookmarks.toggle(authStore.get(), category, anime);
  });
  ipcMain.handle('bookmarks:sync-planning', async (event) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized bookmarks request');
    return bookmarks.syncPlanning(authStore.get());
  });
  ipcMain.handle('stream:prefetch', (event, request) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized streaming request');
    return episodePrefetch.prepare(request);
  });
  ipcMain.handle('stream:episodes', (event, request) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized episode request');
    return streamingResolver.listEpisodes(request);
  });
  ipcMain.handle('stream:discover', async (event, request) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized streaming request');
    if (!['sub', 'dub'].includes(request?.mode) || !Number.isSafeInteger(Number(request?.episode))) throw new Error('Invalid discovery request');
    const key = JSON.stringify([request.anilistId, request.episode, request.mode]);
    const old = discoveredStreams.get(key);
    if (old && old.expires > Date.now()) return old.promise;
    const promise = streamingResolver.resolve(request, { collectAll: true }).then(result => ({
      mode: result.mode,
      episode: result.episode,
      sources: result.sources.map(source => mediaProxy.wrap(source)),
    })).catch(error => { discoveredStreams.delete(key); throw error; });
    discoveredStreams.set(key, { promise, expires: Date.now() + 45000 });
    if (discoveredStreams.size > 100) discoveredStreams.delete(discoveredStreams.keys().next().value);
    return promise;
  });
  ipcMain.handle('stream:cancel-prefetch', event => {
    if (fromMainWindow(event)) episodePrefetch.cancel();
  });
  ipcMain.handle('stream:resolve', async (event, request) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized streaming request');
    try {
      const result = await streamingResolver.resolve(request);
      result.sources = result.sources.map(source => mediaProxy.wrap(source));
      result.stream = result.sources[0];
      return { status: 'ok', result };
    }
    catch (error) { return { status: 'error', code: error.code || 'NO_STREAM', attempts: error.attempts || [] }; }
  });
  ipcMain.handle('player:fullscreen', async (event, enabled, cleanup = false) => {
    if (!fromMainWindow(event) || typeof enabled !== 'boolean') return false;
    mainWindow.setFullScreen(enabled);
    if (enabled) await mainWindow.webContents.executeJavaScript("document.querySelector('.stream-player')?.requestFullscreen().catch(() => {})", true).catch(() => {});
    if (!enabled && cleanup) { episodePrefetch.cancel(); mediaProxy.clear(); }
    return true;
  });
  ipcMain.handle('watch:history', (event) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized history request');
    return watchProgress.all();
  });
  ipcMain.handle('watch:sessions', (event) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized history request');
    return watchHistory.all(authStore.get().id);
  });
  ipcMain.handle('watch:session-save', (event, input) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized history request');
    return watchHistory.save(authStore.get().id, input);
  });
  ipcMain.handle('watch:progress', async (event, input) => {
    if (!fromMainWindow(event) || !authStore.get()) throw new Error('Unauthorized progress request');
    const record = watchProgress.save(input.anilistId, input.episode, input.seconds, input.duration);
    let synced = false;
    try { synced = await watchProgress.sync(authStore.get(), record); } catch { /* Local record remains authoritative until retry. */ }
    return { record, synced };
  });
  ipcMain.on('watch:progress-sync', (event, input) => {
    if (!fromMainWindow(event) || !authStore.get()) { event.returnValue = false; return; }
    try { watchProgress.save(input.anilistId, input.episode, input.seconds, input.duration); event.returnValue = true; }
    catch { event.returnValue = false; }
  });
  ipcMain.handle('update:check', async (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
    return updateCheck;
  });
  ipcMain.handle('update:status', async (event) => {
    if (!fromMainWindow(event)) return null;
    if (!releaseStatusRequest) releaseStatusRequest = (async () => {
      const current = app.getVersion();
      const [release, history] = await Promise.all([getLatestRelease(), getReleaseHistory()]);
      if (history) releaseHistory = history;
      const latest = [release, ...(history || [])].filter(Boolean).sort((a, b) => compareVersions(b.version, a.version))[0];
      const updateAvailable = !!latest && compareVersions(latest.version, current) === 1;
      availableUpdate = updateAvailable ? latest : null;
      previewActive = false;
      const releases = [...releaseHistory];
      if (latest && !releases.some(item => item.version === latest.version)) releases.unshift(latest);
      releaseHistory = releases;
      return { current, latest: latest?.version ?? null, release: latest, releases, updateAvailable,
        status: latest ? 'ready' : 'unavailable', historyUnavailable: history === null };
    })().finally(() => { releaseStatusRequest = null; });
    return releaseStatusRequest;
  });
  ipcMain.handle('update:preview', (event) => {
    if (app.isPackaged || BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
    previewActive = true;
    availableUpdate = previewRelease();
    return availableUpdate;
  });
  ipcMain.handle('update:open', async (event, version) => {
    if (!fromMainWindow(event)) return false;
    if (version) {
      const release = releaseHistory.find(item => item.version === version);
      if (!release) return false;
      await shell.openExternal(release.url);
      return true;
    }
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow || !availableUpdate) return false;
    await shell.openExternal(availableUpdate.url);
    return true;
  });
  ipcMain.handle('window:action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow) return false;

    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'maximize':
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case 'close': win.close(); break;
      default: return false;
    }
    return win.isDestroyed() ? false : win.isMaximized();
  });

  createWindow();
  const previewUpdate = !app.isPackaged && process.env.ANIMEBLOO_PREVIEW_UPDATE === '1';
  updateCheck = (previewUpdate ? Promise.resolve(previewRelease()) : checkForUpdate()).then((update) => {
    if (!previewActive && !availableUpdate) availableUpdate = update;
    return availableUpdate;
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { mediaProxy.close(); });
