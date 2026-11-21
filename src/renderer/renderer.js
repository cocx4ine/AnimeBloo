import { createUpdates } from './updates.js';
import { gsap } from 'gsap';
import Hls from 'hls.js';
import { mountAniSkip, readAutoSkip, saveAutoSkip } from './aniSkip.js';
import { HLS_BUFFER_CONFIG, shouldPrefetch, bufferedRanges } from './playbackBuffer.mjs';
import { languageNames, translate, translations } from './i18n.js';
import { mountUpscaling, UPSCALE_PROFILES, normalizeUpscaling } from './upscaling.js';
import { formatWatchTime, watchTotals } from './history.mjs';
import { applyAccent, appearanceMarkup, mountAppearance, tintLogos } from './appearance.js';
import { cleanSynopsis } from '../synopsis.cjs';

tintLogos();
var navigation = [...document.querySelectorAll(".nav-item, .nav-btn")];
var navigationPage = (button) => button.dataset.nav || button.dataset.page;
var sidebar = document.querySelector(".sidebar");
var navIndicator = sidebar.querySelector(".nav-indicator");
var content = document.querySelector(".page-content");
var main = document.querySelector("#main-content");
var maximizeButtons = [...document.querySelectorAll('[data-window-action="maximize"]')];
var updateBanner = document.querySelector(".update-banner");
var updateButton = updateBanner.querySelector(".update-banner-button");
var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
gsap.ticker.fps(60);
const favoriteIcon = '<span class="favorite-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><use href="#icon-heart"/></svg></span>';
function animateFavoriteIcon(button) {
  if (reduceMotion.matches) return;
  const icon = button.querySelector('.favorite-icon svg');
  if (!icon) return;
  gsap.killTweensOf(icon);
  gsap.timeline({ defaults: { force3D: true, overwrite: 'auto' } })
    .fromTo(icon, { scale: 0.85 }, { scale: 1.12, duration: 0.16, ease: 'power2.out' })
    .to(icon, { scale: 1, duration: 0.24, ease: 'elastic.out(1, 0.55)', clearProps: 'transform' });
}
var splash = document.querySelector("#splash-overlay");
var splashFallback = document.querySelector("#splash-fallback");
var splashVideo = document.querySelector("#splash-video");
var appShell = document.querySelector(".app-shell");
var authScreen = document.querySelector("#auth-screen");
var authCard = authScreen.querySelector(".auth-card");
var authForm = document.querySelector("#auth-form");
var authToken = document.querySelector("#auth-token");
var authStatus = document.querySelector("#auth-status");
var authConnect = authForm.querySelector(".auth-connect");
var profile = null;
var authBusy = false;
var authMessage = "";
var authReady = false;
var splashStarted = false;
var splashFinished = false;
var splashTimer;
function showAuth(message = "") {
  authMessage = message;
  if (!splashFinished) return;
  gsap.killTweensOf([appShell, authScreen, authCard]);
  appShell.setAttribute("inert", "");
  appShell.setAttribute("aria-hidden", "true");
  authScreen.hidden = false;
  authScreen.removeAttribute("inert");
  authStatus.textContent = message ? authT(message) : "";
  if (!reduceMotion.matches) gsap.fromTo(authCard, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, clearProps: "all" });
}
function showApp() {
  if (!splashFinished) return;
  gsap.killTweensOf([appShell, authScreen, authCard]);
  const reveal = () => {
    authScreen.hidden = true;
    authScreen.setAttribute("inert", "");
    appShell.removeAttribute("inert");
    appShell.removeAttribute("aria-hidden");
    if (!reduceMotion.matches) gsap.fromTo(appShell, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, clearProps: "all" });
  };
  if (authScreen.hidden || reduceMotion.matches) reveal();
  else gsap.to(authCard, { autoAlpha: 0, duration: 0.1, onComplete: reveal });
}
function finishSplash() {
  if (splashFinished) return;
  splashFinished = true;
  clearTimeout(splashTimer);
  splashVideo.pause();
  splash.hidden = true;
  document.body.classList.remove("splash-active");
  if (profile) showApp();
  else showAuth(authReady ? authMessage : "authLoading");
}
function startSplash() {
  if (splashStarted) return;
  splashStarted = true;
  if (reduceMotion.matches) {
    finishSplash();
    return;
  }
  // SVG animation inherits the accent; video frames contain a baked-in blue tint.
  splashFallback.hidden = false;
  splashVideo.hidden = true;
  gsap.fromTo(splashFallback, { autoAlpha: 0, scale: .92 }, { autoAlpha: 1, scale: 1, duration: .7, ease: 'power2.out' });
  gsap.fromTo(splashFallback.querySelector('.accent-logo'), { rotation: -12, y: 10 }, { rotation: 0, y: 0, duration: 1.1, ease: 'power3.out' });
  splashTimer = setTimeout(finishSplash, 1400);
}
window.animeBloo.onWindowShown(startSplash);
var pageNumbers = { home: "01", search: "02", bookmarks: "03", history: "04", update: "05", settings: "06" };
var pageNotes = { search: "searchNote", bookmarks: "bookmarksNote", history: "historyNote", update: "updateNote", settings: "settingsNote" };
var language = translations[window.animeBloo.initialLanguage] ? window.animeBloo.initialLanguage : "en";
var currentPage = "home";
var isMaximized = false;
var languageMenuOpen = false;
var cacheBusy = false;
var cacheRefreshTimer = null;
var cacheRefreshGeneration = 0;
var availableUpdate = null;
var theme = window.animeBloo.initialTheme.mode;
var themeTransitionTimer;
var searchTerm = "";
var searchResults = [];
var selectedAnime = null;
var playingEpisode = null;
var watchProgress = {};
var hlsPlayer = null;
var playerOpen = false;
var playerHudTimer;
var playerFeedbackTimer;
var playerClosing = false;
const playerIcons = {
  back: '<path d="m15 5-7 7 7 7"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
  rewind: '<path d="M11 6a8 8 0 1 0 7 3"/><path d="M11 2v4H7"/><text x="12" y="15" text-anchor="middle" font-size="7" font-weight="700" stroke="none" fill="currentColor">10</text>',
  forward: '<path d="M13 6a8 8 0 1 1-7 3"/><path d="M13 2v4h4"/><text x="12" y="15" text-anchor="middle" font-size="7" font-weight="700" stroke="none" fill="currentColor">10</text>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6m0-6-5 6"/>',
  next: '<path d="m5.5 5.5 9 6.5-9 6.5v-13Z"/><path d="M19 5.5v13"/>',
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  shrink: '<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>'
};
function playerIcon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${playerIcons[name]}</svg>`; }
var disposeAniSkip = null;
var playbackGeneration = 0;
var failedProviders = [];
var failedSources = new Set();
var streamLoadTimer;
var loadingTween;
var fallbackResume = null;
var nextEpisodePrefetch = null;
var episodeAvailabilityGeneration = 0;
var availableStreamEpisodes = null;
var episodeAvailabilityLoading = false;
var episodeTrackDiscovery = null;
const streamModeKey = anime => `animebloo:stream-mode:${anime.id}`;
const streamPreferenceKey = anime => `animebloo:stream-preferences:${anime.id}`;
const cleanVisibleLabel = value => String(value || '').replace(/hi[ -]?anime/gi, '').trim();
function streamPreferences(anime = selectedAnime) {
  if (!anime) return { mode: 'sub', audioLang: '', subtitleLang: '' };
  try {
    const stored = JSON.parse(localStorage.getItem(streamPreferenceKey(anime)) || '{}');
    return { mode: ['sub', 'dub'].includes(stored.mode) ? stored.mode : localStorage.getItem(streamModeKey(anime)) === 'dub' ? 'dub' : 'sub',
      audioLang: typeof stored.audioLang === 'string' ? stored.audioLang : '',
      subtitleLang: typeof stored.subtitleLang === 'string' ? stored.subtitleLang : '' };
  } catch { return { mode: 'sub', audioLang: '', subtitleLang: '' }; }
}
function saveStreamPreferences(next) {
  if (!selectedAnime) return;
  try { localStorage.setItem(streamPreferenceKey(selectedAnime), JSON.stringify(next)); localStorage.setItem(streamModeKey(selectedAnime), next.mode); } catch {}
}
function preferredStreamMode(anime = selectedAnime) {
  return streamPreferences(anime).mode;
}
function languageCode(raw) {
  const value = cleanVisibleLabel(raw).toLowerCase();
  return ({ ita: 'it', jpn: 'ja', eng: 'en', spa: 'es', fra: 'fr', deu: 'de', por: 'pt', ron: 'ro', zho: 'zh', kor: 'ko', ara: 'ar', hin: 'hi', rus: 'ru', italian: 'it', italiano: 'it', japanese: 'ja', giapponese: 'ja', english: 'en', inglese: 'en', spanish: 'es', español: 'es', spagnolo: 'es', french: 'fr', français: 'fr', francese: 'fr', german: 'de', deutsch: 'de', tedesco: 'de', portuguese: 'pt', português: 'pt', romanian: 'ro', română: 'ro', chinese: 'zh', korean: 'ko', arabic: 'ar', hindi: 'hi', russian: 'ru' })[value] || value.split('-')[0];
}
function validLanguage(raw) {
  const code = languageCode(raw);
  return /^[a-z]{2,3}$/.test(code) && !['und', 'mul', 'zxx'].includes(code) ? code : '';
}
function languageLabel(raw) {
  const value = cleanVisibleLabel(raw);
  if (!value) return '';
  try { return new Intl.DisplayNames([language], { type: 'language' }).of(languageCode(value)) || value; } catch { return value; }
}
function knownAudioLanguages() {
  const result = new Map();
  const mode = preferredStreamMode();
  const current = playingEpisode?.mode === mode && playerOpen;
  const prefetched = !playerOpen && nextEpisodePrefetch?.mode === mode && nextEpisodePrefetch.number === targetEpisode(selectedAnime).number;
  const discovered = episodeTrackDiscovery?.anime === selectedAnime && episodeTrackDiscovery.mode === mode && episodeTrackDiscovery.number === (current ? playingEpisode.number : targetEpisode(selectedAnime).number) ? episodeTrackDiscovery.result?.sources : null;
  for (const source of discovered || (current ? playingEpisode.sources : prefetched ? nextEpisodePrefetch.result?.sources : []) || []) {
    if (source.mode !== mode) continue;
    const raw = source.audioLanguage;
    const code = validLanguage(raw);
    if (code) result.set(code, languageLabel(raw));
    for (const language of source.audioLanguages || []) {
      const code = validLanguage(language);
      if (code) result.set(code, languageLabel(language));
    }
  }
  for (const track of current ? hlsPlayer?.audioTracks || [] : []) {
    const raw = track.lang || track.name;
    const code = validLanguage(raw);
    if (code) result.set(code, languageLabel(raw));
  }
  if (current) for (const track of content.querySelector('.stream-player video')?.audioTracks || []) {
    const raw = track.language || track.label;
    const code = validLanguage(raw);
    if (code) result.set(code, languageLabel(raw));
  }
  return result;
}
function knownSubtitleLanguages() {
  const result = new Map();
  const mode = preferredStreamMode();
  const current = playingEpisode?.mode === mode && playerOpen;
  const prefetched = !playerOpen && nextEpisodePrefetch?.mode === mode && nextEpisodePrefetch.number === targetEpisode(selectedAnime).number;
  const discovered = episodeTrackDiscovery?.anime === selectedAnime && episodeTrackDiscovery.mode === mode && episodeTrackDiscovery.number === (current ? playingEpisode.number : targetEpisode(selectedAnime).number) ? episodeTrackDiscovery.result?.sources : null;
  for (const source of discovered || (current ? playingEpisode.sources : prefetched ? nextEpisodePrefetch.result?.sources : []) || []) {
    if (source.mode !== mode) continue;
    for (const track of source.subtitles || []) {
      const raw = track.language;
      const code = validLanguage(raw);
      if (code) result.set(code, languageLabel(raw));
    }
    for (const language of source.subtitleLanguages || []) {
      const code = validLanguage(language);
      if (code) result.set(code, languageLabel(language));
    }
  }
  for (const track of current ? hlsPlayer?.subtitleTracks || [] : []) {
    const raw = track.lang || track.name;
    const code = validLanguage(raw);
    if (code) result.set(code, languageLabel(raw));
  }
  return result;
}
function refreshStreamPreferences() {
  const pref = streamPreferences();
  const audioOptions = [...knownAudioLanguages()];
  const subtitleOptions = [...knownSubtitleLanguages()];
  const audioLang = audioOptions.some(([code]) => code === pref.audioLang) ? pref.audioLang : audioOptions[0]?.[0] || '';
  const subtitleLang = subtitleOptions.some(([code]) => code === pref.subtitleLang) || (pref.subtitleLang === 'off' && subtitleOptions.length) ? pref.subtitleLang : subtitleOptions[0]?.[0] || '';
  if (selectedAnime && (audioOptions.length || subtitleOptions.length) && (audioLang !== pref.audioLang || subtitleLang !== pref.subtitleLang)) saveStreamPreferences({ ...pref, audioLang: audioOptions.length ? audioLang : pref.audioLang, subtitleLang: subtitleOptions.length ? subtitleLang : pref.subtitleLang });
  for (const panel of content.querySelectorAll('[data-stream-panel]')) {
    panel.querySelectorAll('[data-stream-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.streamMode === pref.mode)));
    const audio = panel.querySelector('[data-audio-lang]');
    const subtitles = panel.querySelector('[data-subtitle-lang]');
    audio.innerHTML = audioOptions.map(([code, label]) => `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`).join('');
    subtitles.innerHTML = subtitleOptions.map(([code, label]) => `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`).join('') + (subtitleOptions.length ? `<option value="off">${escapeHtml(t('trackOff'))}</option>` : '');
    audio.value = audioLang; subtitles.value = subtitleLang;
    for (const select of [audio, subtitles]) {
      const dropdown = select.closest('[data-stream-dropdown]');
      const trigger = dropdown.querySelector('[data-stream-dropdown-trigger]');
      const menu = dropdown.querySelector('[data-stream-dropdown-menu]');
      trigger.querySelector('span').textContent = select.selectedOptions[0]?.textContent || (streamBusy || (!playerOpen && nextEpisodePrefetch && !nextEpisodePrefetch.result) ? t('streamModeLoading') : t('cacheSizeUnavailable'));
      trigger.disabled = !select.options.length;
      menu.innerHTML = [...select.options].map(option => `<button type="button" role="option" data-stream-option="${escapeHtml(option.value)}" aria-selected="${option.selected}">${escapeHtml(option.textContent)}</button>`).join('');
    }
    panel.querySelector('[data-track-count]').textContent = String(audioOptions.length + subtitleOptions.length);
  }
}
function applyStreamTracks(video) {
  const pref = streamPreferences();
  const matches = track => languageCode(track.lang || track.language || track.name || track.label) === pref.audioLang;
  if (hlsPlayer && pref.audioLang) {
    const index = hlsPlayer.audioTracks.findIndex(matches);
    if (index >= 0) hlsPlayer.audioTrack = index;
  }
  for (const track of video.audioTracks || []) track.enabled = !!pref.audioLang && matches(track);
  const native = [...video.textTracks];
  const nativeIndex = native.findIndex(track => languageCode(track.language || track.label) === pref.subtitleLang);
  native.forEach((track, index) => { track.mode = pref.subtitleLang === 'off' ? 'disabled' : index === nativeIndex ? 'showing' : 'disabled'; });
  if (hlsPlayer) {
    if (pref.subtitleLang === 'off') hlsPlayer.subtitleTrack = -1;
    else hlsPlayer.subtitleTrack = hlsPlayer.subtitleTracks.findIndex(track => languageCode(track.lang || track.name) === pref.subtitleLang);
  }
}
function streamPanelMarkup(anime) {
  const mode = preferredStreamMode(anime);
  const field = (name, attribute) => `<div class="stream-track-field"><span>${name}</span><div class="stream-dropdown" data-stream-dropdown><select ${attribute} tabindex="-1" aria-hidden="true"></select><button type="button" class="stream-dropdown-trigger" data-stream-dropdown-trigger aria-haspopup="listbox" aria-expanded="false"><span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div class="stream-dropdown-menu" data-stream-dropdown-menu role="listbox" hidden></div></div></div>`;
  return `<section class="stream-preferences" data-stream-panel aria-label="${t('streamModeLabel')}"><div class="stream-panel-head"><div class="stream-mode-selector" data-stream-mode-selector data-mode="${mode}" role="group" aria-label="${t('streamModeLabel')}"><span class="stream-mode-indicator" aria-hidden="true"></span><button type="button" data-stream-mode="sub" aria-pressed="${mode === 'sub'}">Sub</button><button type="button" data-stream-mode="dub" aria-pressed="${mode === 'dub'}">Dub</button></div><button class="stream-panel-expand" type="button" data-stream-panel-expand aria-expanded="false" aria-label="${t('trackExpand')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4 4.5-4"/></svg></button></div><div class="stream-panel-body" data-stream-panel-body hidden><div class="stream-track-fields">${field(t('trackAudio'), 'data-audio-lang')}${field(t('trackSubtitles'), 'data-subtitle-lang')}</div><span class="stream-track-count" data-track-count aria-label="${t('trackCount')}">0</span><span class="stream-mode-notice" data-stream-mode-notice role="status" aria-live="polite"></span></div></section>`;
}
function closeStreamDropdowns(except = null) {
  for (const dropdown of content.querySelectorAll('[data-stream-dropdown]')) {
    if (dropdown === except) continue;
    const menu = dropdown.querySelector('[data-stream-dropdown-menu]');
    if (menu.hidden) continue;
    gsap.killTweensOf(menu);
    dropdown.querySelector('[data-stream-dropdown-trigger]').setAttribute('aria-expanded', 'false');
    gsap.to(menu, { y: -4, opacity: 0, duration: reduceMotion.matches ? 0 : .16, ease: 'power2.in', force3D: true, onComplete: () => { menu.hidden = true; gsap.set(menu, { clearProps: 'transform,opacity' }); } });
  }
}
function setStreamMode(mode) {
  for (const selector of content.querySelectorAll('[data-stream-mode-selector]')) {
    const previous = selector.dataset.mode;
    const indicator = selector.querySelector('.stream-mode-indicator');
    const dubX = selector.querySelector('[data-stream-mode="dub"]').offsetLeft - selector.querySelector('[data-stream-mode="sub"]').offsetLeft;
    selector.dataset.mode = mode;
    selector.querySelectorAll('[data-stream-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.streamMode === mode)));
    if (reduceMotion.matches) gsap.set(indicator, { x: mode === 'dub' ? dubX : 0 });
    else gsap.fromTo(indicator, { x: previous === 'dub' ? dubX : 0, opacity: .75 }, { x: mode === 'dub' ? dubX : 0, opacity: 1, duration: .24, ease: 'power2.out', force3D: true, overwrite: 'auto' });
  }
}
function changeStreamMode(mode) {
  if (!selectedAnime || !['sub', 'dub'].includes(mode) || preferredStreamMode() === mode) return;
  saveStreamPreferences({ ...streamPreferences(), mode, audioLang: '', subtitleLang: '' });
  setStreamMode(mode);
  cancelNextEpisodePrefetch();
  episodeTrackDiscovery = null;
  availableStreamEpisodes = null;
  refreshStreamPreferences();
  if (playerOpen && playingEpisode) switchPreferredStream();
  else { prefetchSelectedEpisode(); discoverEpisodeTracks(targetEpisode(selectedAnime).number); }
  refreshEpisodeAvailability();
}
function discoverEpisodeTracks(number) {
  const anime = selectedAnime, mode = preferredStreamMode(anime);
  if (!anime?.year || !number || !window.animeBloo.discoverStreamTracks) return null;
  if (episodeTrackDiscovery?.anime === anime && episodeTrackDiscovery.number === number && episodeTrackDiscovery.mode === mode) return episodeTrackDiscovery.promise;
  const slot = { anime, number, mode, result: null, promise: null };
  episodeTrackDiscovery = slot;
  slot.promise = window.animeBloo.discoverStreamTracks({ anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, episode: number, mode }).then(result => {
    if (episodeTrackDiscovery === slot && result?.episode === number && result.mode === mode) {
      slot.result = result;
      refreshStreamPreferences();
    }
    return result;
  }).catch(() => { if (episodeTrackDiscovery === slot) episodeTrackDiscovery = null; return null; });
  return slot.promise;
}
async function switchPreferredStream() {
  const video = content.querySelector('.stream-player video');
  if (!video || !playingEpisode) return;
  const number = playingEpisode.number;
  const resume = { time: video.currentTime || 0, playing: !video.paused };
  const anime = selectedAnime;
  const mode = preferredStreamMode();
  discoverEpisodeTracks(number);
  cancelNextEpisodePrefetch();
  ++playbackGeneration;
  const generation = playbackGeneration;
  setPlayerLoading(true);
  const request = { anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, episode: number, mode, audioLang: streamPreferences(anime).audioLang, excludeProviders: [] };
  const prefetched = window.animeBloo.prefetchStream?.(request).catch(() => null);
  const response = await prefetched;
  if (generation !== playbackGeneration || !playerOpen || selectedAnime !== anime) return;
  failedProviders = []; failedSources.clear(); fallbackResume = resume;
  await resolveNextProvider(number, response?.status === 'ok' ? Promise.resolve(response) : null);
}
function changeTrackPreference(kind, value) {
  if (!selectedAnime) return;
  const available = kind === 'audio' ? knownAudioLanguages() : knownSubtitleLanguages();
  if (!available.has(value) && !(kind === 'subtitle' && value === 'off' && available.size)) return;
  const key = kind === 'audio' ? 'audioLang' : 'subtitleLang';
  const pref = streamPreferences();
  if (pref[key] === value) return;
  saveStreamPreferences({ ...pref, [key]: value });
  refreshStreamPreferences();
  if (kind === 'audio') cancelNextEpisodePrefetch();
  const video = content.querySelector('.stream-player video');
  if (!video || !playingEpisode) { if (kind === 'audio') prefetchSelectedEpisode(); return; }
  if (kind === 'subtitle') {
    const hasSubtitle = item => (item.subtitles || []).some(track => languageCode(track.language) === value) || (item.subtitleLanguages || []).some(lang => languageCode(lang) === value);
    const currentHasTrack = value === 'off' || hasSubtitle(playingEpisode) || (hlsPlayer?.subtitleTracks || []).some(track => languageCode(track.lang || track.name) === value);
    const discovered = episodeTrackDiscovery?.anime === selectedAnime && episodeTrackDiscovery.number === playingEpisode.number && episodeTrackDiscovery.mode === preferredStreamMode() ? episodeTrackDiscovery.result?.sources || [] : [];
    const source = currentHasTrack ? null : [...playingEpisode.sources, ...discovered].find(item => hasSubtitle(item));
    if (source && source.url !== playingEpisode.url) {
      const resume = { time: video.currentTime || 0, playing: !video.paused };
      if (!playingEpisode.sources.some(item => item.url === source.url)) playingEpisode.sources.push(source);
      Object.assign(playingEpisode, source);
      attachStream(video, source, resume);
    } else applyStreamTracks(video);
    maybePrefetchNextEpisode(video);
    return;
  }
  const localTrack = (hlsPlayer?.audioTracks || []).findIndex(track => languageCode(track.lang || track.name) === value);
  if (localTrack >= 0) { hlsPlayer.audioTrack = localTrack; maybePrefetchNextEpisode(video); return; }
  const discovered = episodeTrackDiscovery?.anime === selectedAnime && episodeTrackDiscovery.number === playingEpisode.number && episodeTrackDiscovery.mode === preferredStreamMode() ? episodeTrackDiscovery.result?.sources || [] : [];
  const source = [...playingEpisode.sources, ...discovered].find(item => languageCode(item.audioLanguage) === value || (item.audioLanguages || []).some(lang => languageCode(lang) === value));
  if (source && source.url !== playingEpisode.url) {
    const resume = { time: video.currentTime || 0, playing: !video.paused };
    if (!playingEpisode.sources.some(item => item.url === source.url)) playingEpisode.sources.push(source);
    Object.assign(playingEpisode, source);
    attachStream(video, source, resume);
    maybePrefetchNextEpisode(video);
    return;
  }
  if (source?.url === playingEpisode.url) { maybePrefetchNextEpisode(video); return; }
  switchPreferredStream();
}
async function refreshEpisodeAvailability() {
  const anime = selectedAnime;
  if (!anime || !window.animeBloo.getStreamEpisodes) return;
  const mode = preferredStreamMode(anime);
  const generation = ++episodeAvailabilityGeneration;
  episodeAvailabilityLoading = true;
  availableStreamEpisodes = null;
  updateEpisodeAvailability();
  try {
    const result = await window.animeBloo.getStreamEpisodes({ anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, mode });
    if (generation !== episodeAvailabilityGeneration || selectedAnime !== anime || preferredStreamMode(anime) !== mode) return;
    availableStreamEpisodes = new Set(result?.mode === mode ? result.episodes : []);
  } catch {
    if (generation !== episodeAvailabilityGeneration || selectedAnime !== anime) return;
    availableStreamEpisodes = null;
  }
  episodeAvailabilityLoading = false;
  updateEpisodeAvailability();
  if (!playerOpen && availableStreamEpisodes?.size) prefetchSelectedEpisode();
  if (!playerOpen && availableStreamEpisodes?.size) discoverEpisodeTracks(targetEpisode(anime).number);
}
function updateEpisodeAvailability() {
  if (!selectedAnime || currentPage !== 'search') return;
  const list = content.querySelector('.episode-list');
  if (!list) return;
  for (const button of list.querySelectorAll('[data-play-episode]')) {
    button.hidden = availableStreamEpisodes !== null && !availableStreamEpisodes.has(Number(button.dataset.playEpisode));
  }
  const watch = content.querySelector('.detail-watch');
  if (watch && availableStreamEpisodes !== null) {
    watch.dataset.playEpisode = String(targetEpisode(selectedAnime).number);
    watch.querySelector('span').textContent = episodeAction(selectedAnime);
    watch.disabled = !availableStreamEpisodes.size;
  }
  let notice = list.querySelector('[data-episode-availability]');
  if (!notice) { notice = document.createElement('p'); notice.dataset.episodeAvailability = ''; notice.className = 'catalog-message'; list.appendChild(notice); }
  notice.hidden = availableStreamEpisodes === null || availableStreamEpisodes.size > 0;
  notice.textContent = episodeAvailabilityLoading ? t('loadingAnime') : t('episodesUnavailable');
}
function toggleStreamPanel(button) {
  const panel = button.closest('[data-stream-panel]');
  const body = panel.querySelector('[data-stream-panel-body]');
  const beside = Boolean(panel.closest('.detail-language-bar'));
  const open = button.getAttribute('aria-expanded') !== 'true';
  if (open) {
    if (!playerOpen && !nextEpisodePrefetch) prefetchSelectedEpisode();
    discoverEpisodeTracks(playerOpen && playingEpisode ? playingEpisode.number : targetEpisode(selectedAnime).number);
  }
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', t(open ? 'trackCollapse' : 'trackExpand'));
  gsap.killTweensOf(body);
  if (open) {
    body.hidden = false;
    gsap.fromTo(body, beside ? { x: -8, scaleX: .96, opacity: 0, transformOrigin: 'left center' } : { y: -6, scaleY: .94, opacity: 0, transformOrigin: 'top center' }, { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, duration: reduceMotion.matches ? 0 : .28, ease: 'power2.out', force3D: true, onComplete: () => gsap.set(body, { clearProps: 'transform,opacity,transformOrigin' }) });
  } else {
    gsap.to(body, { ...(beside ? { x: -8, scaleX: .96, transformOrigin: 'left center' } : { y: -6, scaleY: .94, transformOrigin: 'top center' }), opacity: 0, duration: reduceMotion.matches ? 0 : .24, ease: 'power2.inOut', force3D: true, onComplete: () => { body.hidden = true; gsap.set(body, { clearProps: 'transform,opacity,transformOrigin' }); } });
  }
}
function prefetchSelectedEpisode() {
  if (!selectedAnime?.year || !window.animeBloo.prefetchStream) return;
  const anime = selectedAnime;
  const number = targetEpisode(anime).number;
  if (!number || (availableStreamEpisodes !== null && !availableStreamEpisodes.has(number))) return;
  if (nextEpisodePrefetch?.anime === anime && nextEpisodePrefetch.number === number && nextEpisodePrefetch.mode === preferredStreamMode(anime) && Date.now() - nextEpisodePrefetch.created < 4 * 60 * 1000) return nextEpisodePrefetch.promise;
  const slot = { anime, number, mode: preferredStreamMode(anime), created: Date.now(), promise: null };
  nextEpisodePrefetch = slot;
  slot.promise = window.animeBloo.prefetchStream({ anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, episode: number, mode: preferredStreamMode(anime), audioLang: streamPreferences(anime).audioLang, excludeProviders: [] }).then(response => {
    if (nextEpisodePrefetch === slot && response?.status === 'ok') { slot.result = response.result; refreshStreamPreferences(); }
    return response;
  }).catch(() => ({ status: 'error' }));
}
function cancelNextEpisodePrefetch() {
  nextEpisodePrefetch = null;
  window.animeBloo.cancelStreamPrefetch?.().catch(() => {});
}
function nextEpisodeNumber() {
  return selectedAnime?.episodes.map(item => item.number).filter(number => number > playingEpisode?.number && (availableStreamEpisodes === null || availableStreamEpisodes.has(number))).sort((a, b) => a - b)[0];
}
function maybePrefetchNextEpisode(video) {
  if (!playerOpen || !playingEpisode || !window.animeBloo.prefetchStream || !shouldPrefetch(video.currentTime, video.duration)) return;
  if (nextEpisodePrefetch && Date.now() - nextEpisodePrefetch.created < 4 * 60 * 1000) return;
  const number = nextEpisodeNumber();
  if (!number) return;
  const anime = selectedAnime;
  const slot = { anime, number, mode: preferredStreamMode(anime), created: Date.now(), promise: null };
  nextEpisodePrefetch = slot;
  slot.promise = window.animeBloo.prefetchStream({ anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, episode: number, mode: preferredStreamMode(anime), audioLang: streamPreferences(anime).audioLang, excludeProviders: [] }).catch(() => ({ status: 'error' }));
}
function setPlayerLoading(loading) {
  const spinner = content.querySelector('.player-loading');
  if (spinner) spinner.hidden = !loading;
  if (loading && spinner && !reduceMotion.matches && !loadingTween) loadingTween = gsap.to(spinner.querySelector('span'), { rotation: 360, duration: 0.85, ease: 'none', repeat: -1 });
  if (!loading) { loadingTween?.kill(); loadingTween = null; }
}
function closePlayer(render = true, preservePrefetch = false) {
  clearTimeout(playerHudTimer);
  clearTimeout(playerFeedbackTimer);
  playerClosing = false;
  saveCurrentProgress();
  disposeAniSkip?.(); disposeAniSkip = null;
  ++playbackGeneration;
  clearTimeout(streamLoadTimer);
  loadingTween?.kill(); loadingTween = null;
  playerOpen = false;
  if (!preservePrefetch) cancelNextEpisodePrefetch();
  streamBusy = false;
  playingEpisode = null;
  hlsPlayer?.destroy(); hlsPlayer = null;
  const video = content.querySelector('.stream-player video');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  upscaleRenderer?.dispose(); upscaleRenderer = null;
  if (!preservePrefetch) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.animeBloo.setPlayerFullscreen?.(false, true).catch(() => {});
  }
  if (render) renderPage();
}
function closePlayerAnimated() {
  if (!playerOpen || playerClosing) return;
  playerClosing = true;
  const player = content.querySelector('.stream-player');
  const back = player?.querySelector('.player-back');
  clearTimeout(playerHudTimer);
  saveCurrentProgress();
  if (!player || reduceMotion.matches) { closePlayer(); return; }
  gsap.timeline({ onComplete: () => closePlayer() })
    .to(back, { scale: .92, duration: .12, ease: 'power3.out', force3D: true }, 0)
    .to(player, { opacity: 0, scale: 1.015, duration: .28, ease: 'power3.out', force3D: true }, .04);
}
function showPlayerHud() {
  if (!playerOpen || playerClosing) return;
  const player = content.querySelector('.stream-player');
  if (!player) return;
  clearTimeout(playerHudTimer);
  player.classList.remove('hud-hidden');
  for (const selector of ['.player-top-hud', '.upscale-playback-controls']) {
    const element = player.querySelector(selector);
    if (element) gsap.to(element, { y: 0, opacity: 1, duration: reduceMotion.matches ? 0 : .32, ease: 'power3.out', force3D: true, overwrite: 'auto' });
  }
  const video = player.querySelector('video');
  if (video && !video.paused) playerHudTimer = setTimeout(hidePlayerHud, 2500);
}
function hidePlayerHud() {
  const player = content.querySelector('.stream-player');
  const video = player?.querySelector('video');
  if (!playerOpen || !player || !video || video.paused || player.querySelector(':focus-visible') || player.querySelector('.player-timeline:hover')) return;
  player.classList.add('hud-hidden');
  gsap.to(player.querySelector('.player-top-hud'), { y: -12, opacity: 0, duration: reduceMotion.matches ? 0 : .3, ease: 'power3.out', force3D: true, overwrite: 'auto' });
  gsap.to(player.querySelector('.upscale-playback-controls'), { y: 14, opacity: 0, duration: reduceMotion.matches ? 0 : .3, ease: 'power3.out', force3D: true, overwrite: 'auto' });
}
function showPlayerFeedback(icon) {
  const feedback = content.querySelector('.player-feedback');
  if (!feedback) return;
  clearTimeout(playerFeedbackTimer);
  feedback.innerHTML = playerIcon(icon);
  gsap.killTweensOf(feedback);
  gsap.fromTo(feedback, { opacity: 0, scale: .78 }, { opacity: 1, scale: 1, duration: reduceMotion.matches ? 0 : .22, ease: 'expo.out', force3D: true });
  playerFeedbackTimer = setTimeout(() => gsap.to(feedback, { opacity: 0, scale: 1.12, duration: reduceMotion.matches ? 0 : .24, ease: 'power3.out', force3D: true }), 480);
}
function togglePlayerPlayback(video) {
  const wasPaused = video.paused;
  if (wasPaused) video.play().catch(() => {});
  else video.pause();
  showPlayerFeedback(wasPaused ? 'play' : 'pause');
  showPlayerHud();
}
function seekPlayer(video, delta) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
  showPlayerFeedback(delta < 0 ? 'rewind' : 'forward');
  showPlayerHud();
}
function togglePlayerFullscreen() {
  const stage = content.querySelector('.stream-player');
  if (!stage) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else stage.requestFullscreen().catch(() => {});
  window.animeBloo.setPlayerFullscreen?.(!document.fullscreenElement).catch(() => {});
  showPlayerHud();
}
window.animeBloo.onPlayerExit?.(() => closePlayer());
window.addEventListener('beforeunload', () => { saveCurrentProgress(undefined, false, true); cancelNextEpisodePrefetch(); });
var qualityMode = "auto";
var availableQualities = [];
var upscaleStorageKey = "animebloo.upscaling.v1";
var upscaleSettings = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(upscaleStorageKey));
    return normalizeUpscaling(saved);
  } catch {
    return { enabled: true, profile: "balanced" };
  }
})();
var upscaleRenderer = null;
var upscaleUnavailable = false;
var streamError = "";
var streamBusy = false;
var selectedId = null;
var animeReturnPage = "search";
var catalogBusy = false;
var catalogError = false;
var catalogRequest = 0;
var searchTimer;
var homeFeed = { trending: [], upcoming: [], releases: [], recommended: [], current: [], favorites: [] };
var bookmarks = { favorite: [], likes: [], planning: [] };
var bookmarkTab = "favorite";
var bookmarkBusy = false;
var bookmarkError = false;
var homeHistory = [];
var homeRequest = 0;
const HOME_CACHE_AGE = 12 * 60 * 60_000;
function homeCacheKey() { return `animebloo:home:v2:${profile?.id}`; }
function saveHomeCache() {
  if (!profile?.id) return;
  try { localStorage.setItem(homeCacheKey(), JSON.stringify({ savedAt: Date.now(), feed: homeFeed, history: homeHistory, bookmarks })); } catch {}
}
function restoreHomeCache() {
  if (!profile?.id) return;
  try {
    const cached = JSON.parse(localStorage.getItem(homeCacheKey()) || 'null');
    if (!cached || Date.now() - cached.savedAt > HOME_CACHE_AGE) return;
    if (cached.feed && Array.isArray(cached.feed.trending)) homeFeed = cached.feed;
    if (Array.isArray(cached.history)) homeHistory = cached.history;
    if (cached.bookmarks && Array.isArray(cached.bookmarks.favorite)) bookmarks = cached.bookmarks;
  } catch {}
}
function homeDeadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Home request timed out')), ms); })]).finally(() => clearTimeout(timer));
}
function latestProgress(anilistId) {
  return watchProgress[`latest:${anilistId}`] || Object.values(watchProgress).filter((record) => record?.anilistId === anilistId && !String(record.status).startsWith('latest')).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}
function targetEpisode(anime) {
  const record = latestProgress(anime.id);
  const numbers = (anime.episodes || []).map((episode) => episode.number).filter(number => anime !== selectedAnime || availableStreamEpisodes === null || availableStreamEpisodes.has(number)).sort((a, b) => a - b);
  const first = numbers[0] || 1;
  if (!record) return { number: first, resume: false };
  const completed = record.status === 'completed' || (record.duration > 0 && record.seconds / record.duration >= .9);
  const number = completed ? (numbers.find((item) => item > record.episode) || numbers.at(-1) || first) : (numbers.includes(record.episode) ? record.episode : first);
  return { number, resume: !completed && record.seconds > 0 };
}
function episodeAction(anime) {
  const target = targetEpisode(anime);
  return (t(target.resume ? 'resumeEpisode' : 'watchEpisode') || (target.resume ? 'Resume Episode {number}' : 'Watch Episode {number}')).replace('{number}', target.number);
}
function saveCurrentProgress(video = content.querySelector('.stream-player video'), completed = false, synchronous = false) {
  if (!video || !playingEpisode || !selectedAnime) return;
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const seconds = completed ? duration : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
  const record = { anilistId: selectedAnime.id, episode: playingEpisode.number, episodeNumber: playingEpisode.number, seconds, currentTime: seconds, duration, status: completed || duration > 0 && seconds / duration >= .9 ? 'completed' : 'in_progress', updatedAt: new Date().toISOString() };
  watchProgress[`${record.anilistId}:${record.episode}`] = record;
  watchProgress[`latest:${record.anilistId}`] = record;
  lastProgressWrite = Date.now();
  if (synchronous) window.animeBloo.saveWatchProgressSync(record);
  else window.animeBloo.saveWatchProgress(record).catch(() => {});
}
var watchSessions = [];
var historyBusy = false;
var historyError = false;
var historyRequest = 0;
var activeWatchSession = null;
var homeBusy = true;
var homeError = false;
var heroIndex = 0;
var heroTimer;
var heroTimeline;
var heroTransitioning = false;
var HERO_INTERVAL = 5500;
var t = (key) => translate(language, key);
var authT = (key) => translate("en", key);
var escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
var COVER_PLACEHOLDER = "./assets/fallback-cover.svg";
var WIDE_PLACEHOLDER = "./assets/fallback-thumbnail.svg";
var remoteImage = (value) => typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value) ? value : null;
var artworkCandidates = (image, cover, placeholder) => [...new Set([...Array.isArray(image) ? image : [image], cover].map(remoteImage).filter(Boolean))].concat(placeholder);
var imageTag = (image, cover, placeholder = WIDE_PLACEHOLDER, attributes = "") => {
  const candidates = artworkCandidates(image, cover, placeholder);
  return `<img src="${escapeHtml(candidates[0])}" data-art-fallbacks="${escapeHtml(JSON.stringify(candidates.slice(1)))}" alt="" ${attributes}/>`;
};
var animeTitle = (anime) => anime.title?.[language === "ja" ? "native" : "english"] || anime.title?.romaji || anime.title?.english || anime.title?.native || `Anime #${anime.id}`;
var formatPlaybackTime = (seconds) => {
  const total = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
var truncate = (value, limit = 230) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), limit - 25)).trimEnd()}\u2026`;
};
function animate(target, vars) {
  if (!reduceMotion.matches) gsap.to(target, { overwrite: "auto", ...vars });
}
function updateStaticText() {
  document.documentElement.lang = language;
  const translateElement = (el, key) => authScreen.contains(el) ? authT(key) : t(key);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = translateElement(el, el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", translateElement(el, el.dataset.i18nAria));
  });
  navigation.forEach((el) => {
    el.title = t(navigationPage(el));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", translateElement(el, el.dataset.i18nPlaceholder));
  });
  if (!profile && splashFinished) authStatus.textContent = authMessage ? authT(authMessage) : "";
  maximizeButtons.forEach((button) => button.setAttribute("aria-label", translateElement(button, isMaximized ? "restore" : "maximize")));
  if (availableUpdate) {
    updateBanner.querySelector('.update-banner-message').textContent = (availableUpdate.messageIndex !== undefined ? updates.copy(availableUpdate.messageIndex) : '') || (availableUpdate.preview ? updates.copy(9) : t('newVersionAvailable')).replace('{version}', availableUpdate.version);
    updateBanner.querySelector('.update-banner-summary').textContent = availableUpdate.preview ? updates.copy(10) : availableUpdate.summary || '';
    updateButton.textContent = updates.copy(12);
  }
}
function displayUpdate(update) {
  if (!update) return;
  availableUpdate = update;
  updateStaticText();
  updateBanner.hidden = false;
  if (!reduceMotion.matches) {
    gsap.fromTo(updateBanner, { y: -12, scale: 0.985, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.42, ease: "power2.out", clearProps: "all" });
  }
}
async function showAvailableUpdate() {
  try {
    displayUpdate(await window.animeBloo.checkForUpdate());
  } catch {
  }
}
function homeMarkup() {
  const now2 = Date.now();
  const future = [...homeFeed.upcoming || [], ...homeFeed.trending].map((anime) => ({ ...anime, releaseAt: anime.nextAiringAt && anime.nextAiringAt * 1e3 > now2 ? anime.nextAiringAt * 1e3 : anime.startDate ? Date.parse(`${anime.startDate}T12:00:00Z`) : 0, releaseType: "upcoming" })).filter((anime) => anime.releaseAt > now2).sort((a, b) => a.releaseAt - b.releaseAt);
  const recent = homeFeed.releases.filter((anime) => Number.isFinite(anime.airedAt)).map((anime) => ({ ...anime, releaseAt: anime.airedAt * 1e3, releaseType: "newRelease" }));
  const featured = [];
  for (const anime of [...future.slice(0, 2), ...recent, ...future.slice(2)]) {
    if (featured.length === 5) break;
    if (!featured.some((item) => item.id === anime.id)) featured.push(anime);
  }
  heroIndex = Math.min(heroIndex, Math.max(0, featured.length - 1));
  const hero = featured.length ? `<div class="home-hero-feature"><section class="home-hero has-art" aria-label="${escapeHtml(t("newArrivals"))}">
  <div class="home-hero-slides">${featured.map((anime, index) => {
    const favorite = bookmarks.favorite.some((item) => item.id === anime.id);
    const date = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(new Date(anime.releaseAt));
    return `<article class="home-hero-slide${index === heroIndex ? " is-active" : ""}" data-hero-slide="${index}" aria-hidden="${index !== heroIndex}" ${index !== heroIndex ? "inert" : ""}>
      ${imageTag(anime.banner, anime.cover, WIDE_PLACEHOLDER, 'class="home-hero-art"')}
      <div class="home-hero-copy"><span class="home-hero-kicker">${t("newArrivals")}</span><h1>${escapeHtml(animeTitle(anime))}</h1><div class="home-hero-release"><span class="home-hero-badge">${t(anime.releaseType)}</span><time datetime="${new Date(anime.releaseAt).toISOString()}">${t("releaseDate")}: ${escapeHtml(date)}</time></div><div class="home-hero-meta">${anime.score !== null ? `<span class="home-hero-score">\u2605 ${anime.score}%</span>` : ""}${anime.genres.slice(0, 3).map((genre) => `<span>${escapeHtml(genre)}</span>`).join("")}</div><div class="home-hero-actions"><button type="button" class="home-hero-action" data-autoplay="true" data-open-anime="${anime.id}">${escapeHtml(episodeAction(anime))}<svg><use href="#icon-arrow"/></svg></button><button type="button" class="home-hero-favorite${favorite ? " is-favorite" : ""}" data-favorite="${anime.id}" aria-pressed="${favorite}">${favoriteIcon}<span class="favorite-label">${favorite ? t("removeFavorite") : t("addFavorite")}</span></button></div></div>
    </article>`;
  }).join("")}</div>
  </section>${featured.length > 1 ? `<div class="home-hero-pagination" aria-label="${escapeHtml(t("newArrivals"))}"><span class="home-hero-count" aria-live="polite">${String(heroIndex + 1).padStart(2, "0")} / ${String(featured.length).padStart(2, "0")}</span><div class="home-hero-dots" aria-hidden="true">${featured.map((anime, index) => `<span class="home-hero-dot${index === heroIndex ? " is-active" : ""}"></span>`).join("")}</div></div>` : ""}</div>` : "";
  const continueCards = homeHistory.map(({ anime, record, thumbnail }) => {
    const progress = record.duration > 0 ? Math.min(100, Math.max(0, record.seconds / record.duration * 100)) : anime.episodeCount ? Math.min(100, Math.round((record.episode - 1) / anime.episodeCount * 100)) : 0;
    const elapsed = formatPlaybackTime(record.duration > 0 ? Math.min(record.seconds, record.duration) : record.seconds);
    const playbackTime = record.duration > 0 ? `${elapsed} / ${formatPlaybackTime(record.duration)}` : elapsed;
    return `<button class="continue-card" type="button" data-open-anime="${anime.id}" data-autoplay="true"><span class="continue-image">${imageTag(thumbnail || anime.banner, anime.cover, WIDE_PLACEHOLDER, 'loading="lazy"')}<span class="continue-episode">${escapeHtml(episodeAction(anime))}</span></span><span class="continue-title">${escapeHtml(animeTitle(anime))}</span><span class="continue-meta">${playbackTime}</span><span class="continue-progress"><span style="width:${progress}%"></span></span></button>`;
  }).join("");
  const cardRow = (items, label, type = "") => `<section class="home-section"><div class="home-section-heading"><h2>${label}</h2></div><div class="home-row ${type === "trending" ? "trending-row" : type === "releases" ? "release-row" : ""}">${items.map((anime) => `<button class="home-anime-card${type === "releases" ? " home-release-card" : ""}" type="button" data-open-anime="${anime.id}"><span class="home-card-art">${type === "releases" ? imageTag([anime.aniZipThumbnail, anime.kitsuThumbnail, anime.episodeThumbnail, anime.banner], anime.cover, WIDE_PLACEHOLDER, 'loading="lazy"') : imageTag(anime.cover, null, COVER_PLACEHOLDER, 'loading="lazy"')}</span><span class="home-anime-title">${escapeHtml(animeTitle(anime))}</span>${type === "releases" ? `<span class="home-anime-meta">${t("episode")} ${anime.releasedEpisode}${anime.episodeTitle ? ` \xB7 ${escapeHtml(anime.episodeTitle)}` : ""}</span>` : ""}</button>`).join("")}</div></section>`;
  return `<div class="home-dashboard">${hero}${continueCards ? `<section class="home-section"><div class="home-section-heading"><h2>${t("continueWatching")}</h2></div><div class="home-row continue-row">${continueCards}</div></section>` : ""}${homeFeed.trending.length ? cardRow(homeFeed.trending, t("trending"), "trending") : ""}${homeFeed.releases.length ? cardRow(homeFeed.releases, t("newEpisodes"), "releases") : ""}${homeFeed.recommended.length ? cardRow(homeFeed.recommended, t("recommended")) : ""}${homeBusy ? `<div class="home-loading" aria-label="${t("loadingAnime")}"></div>` : homeError ? `<button class="home-retry" type="button" data-reload-home>${t("catalogError")}</button>` : ""}</div>`;
}
function stopHeroSlider() {
  clearTimeout(heroTimer);
  heroTimeline?.kill();
  heroTimeline = null;
  heroTransitioning = false;
}
function scheduleHeroSlide() {
  clearTimeout(heroTimer);
  const hero = content.querySelector(".home-hero");
  if (!hero || hero.querySelectorAll(".home-hero-slide").length < 2 || document.hidden) return;
  heroTimer = setTimeout(() => changeHeroSlide((heroIndex + 1) % hero.querySelectorAll(".home-hero-slide").length), HERO_INTERVAL);
}
function changeHeroSlide(nextIndex) {
  const hero = content.querySelector(".home-hero");
  const slides = [...hero?.querySelectorAll(".home-hero-slide") || []];
  if (!hero || heroTransitioning || nextIndex === heroIndex || nextIndex < 0 || nextIndex >= slides.length) return;
  clearTimeout(heroTimer);
  const outgoing = slides[heroIndex];
  const incoming = slides[nextIndex];
  const direction = nextIndex > heroIndex ? 1 : -1;
  const finish = () => {
    slides.forEach((slide, index) => {
      const active = index === nextIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      if (active) slide.removeAttribute("inert");
      else slide.setAttribute("inert", "");
      gsap.set([slide, slide.querySelector(".home-hero-art"), slide.querySelector(".home-hero-copy")], { clearProps: "all" });
    });
    heroIndex = nextIndex;
    const pagination = hero.parentElement.querySelector(".home-hero-pagination");
    pagination.querySelector(".home-hero-count").textContent = `${String(nextIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    pagination.querySelectorAll(".home-hero-dot").forEach((dot, index) => {
      dot.classList.toggle("is-active", index === nextIndex);
    });
    if (!reduceMotion.matches) gsap.fromTo(pagination, { y: -3, autoAlpha: 0.7 }, { y: 0, autoAlpha: 1, duration: 0.38, ease: "power2.out", force3D: true, overwrite: "auto" });
    heroTimeline = null;
    heroTransitioning = false;
    scheduleHeroSlide();
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  heroTransitioning = true;
  incoming.removeAttribute("inert");
  incoming.setAttribute("aria-hidden", "false");
  gsap.set(incoming, { autoAlpha: 0, zIndex: 2 });
  gsap.set(outgoing, { zIndex: 1 });
  heroTimeline = gsap.timeline({ defaults: { force3D: true }, onComplete: finish }).fromTo(incoming.querySelector(".home-hero-art"), { xPercent: 3 * direction, scale: 1.055 }, { xPercent: 0, scale: 1, duration: 1, ease: "power2.out" }, 0).fromTo(incoming.querySelector(".home-hero-copy"), { x: 22 * direction, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.72, ease: "power2.out" }, 0.18).to(incoming, { autoAlpha: 1, duration: 0.82, ease: "power2.inOut" }, 0).to(outgoing, { autoAlpha: 0, duration: 0.82, ease: "power2.inOut" }, 0).to(outgoing.querySelector(".home-hero-art"), { xPercent: -2 * direction, scale: 1.025, duration: 0.9, ease: "power2.inOut" }, 0).to(outgoing.querySelector(".home-hero-copy"), { x: -16 * direction, autoAlpha: 0, duration: 0.5, ease: "power2.in" }, 0);
}
async function loadHome() {
  if (!profile) return;
  const request = ++homeRequest;
  restoreHomeCache();
  homeBusy = true;
  homeError = false;
  if (currentPage === "home") renderPage();
  const refresh = () => { if (request === homeRequest && currentPage === 'home') renderPage(); };
  const feedTask = homeDeadline(window.animeBloo.getHomeFeed(), 5000).then((value) => {
    if (request !== homeRequest) return;
    homeFeed = value;
    homeBusy = false;
    saveHomeCache();
    refresh();
    if (homeFeed.releases.length) homeDeadline(window.animeBloo.getHomeReleaseArtwork(homeFeed.releases), 3200).then((artwork) => {
      if (request !== homeRequest || !artwork.length) return;
      const byId = new Map(artwork.map((item) => [item.id, item]));
      homeFeed.releases = homeFeed.releases.map((item) => ({ ...item, ...byId.get(item.id) }));
      saveHomeCache();
      refresh();
    }).catch(() => {});
  }, () => {
    if (request !== homeRequest) return;
    homeBusy = false;
    homeError = !homeFeed.trending.length && !homeFeed.releases.length;
    refresh();
  });
  const historyTask = homeDeadline(window.animeBloo.getWatchHistory(), 2500).then((value) => {
    if (request === homeRequest) watchProgress = value;
  });
  const bookmarksTask = homeDeadline(window.animeBloo.getBookmarks(), 2500).then((value) => {
    if (request !== homeRequest) return;
    bookmarks = value;
    saveHomeCache();
    refresh();
  });
  const continueTask = Promise.allSettled([feedTask, historyTask]).then(async () => {
    if (request !== homeRequest) return;
    const recent = Object.entries(watchProgress).filter(([key]) => key.startsWith('latest:')).map(([, record]) => record).concat(Object.values(watchProgress).filter((record) => !watchProgress[`latest:${record.anilistId}`])).filter((record) => record.status !== 'completed' && !(record.duration > 0 && record.seconds / record.duration >= .9)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    for (const entry of homeFeed.current || []) {
      if (!recent.some((record) => record.anilistId === entry.id)) recent.push({ anilistId: entry.id, episode: Math.max(1, entry.progress + 1), seconds: 0, duration: 0 });
    }
    const unique = recent.filter((record, index) => recent.findIndex((item) => item.anilistId === record.anilistId) === index).slice(0, 6);
    const results = await Promise.allSettled(unique.map(async (record) => {
      const anime = await homeDeadline(window.animeBloo.getAnime(record.anilistId, language), 2500);
      return anime ? { anime, record, thumbnail: [anime.episodes.find((episode) => episode.number === record.episode)?.aniZipThumbnail, anime.episodes.find((episode) => episode.number === record.episode)?.kitsuThumbnail, anime.banner] } : null;
    }));
    if (request !== homeRequest) return;
    homeHistory = results.filter((result) => result.status === "fulfilled" && result.value).map((result) => result.value);
    saveHomeCache();
    refresh();
  });
  await Promise.allSettled([feedTask, historyTask, bookmarksTask, continueTask]);
}
async function loadHistory() {
  const request = ++historyRequest;
  historyBusy = true;
  historyError = false;
  if (currentPage === "history") renderPage();
  try {
    const sessions = await window.animeBloo.getWatchSessions();
    if (request === historyRequest) watchSessions = sessions;
  } catch {
    if (request === historyRequest) historyError = true;
  } finally {
    if (request === historyRequest) {
      historyBusy = false;
      if (currentPage === "history") renderPage();
    }
  }
}
function historyMarkup() {
  const totals = watchTotals(watchSessions);
  const stats = [["today", "historyToday"], ["week", "historyWeek"], ["month", "historyMonth"], ["all", "historyAll"]];
  const sessions = [...watchSessions].filter((item) => item.watchedSeconds > 0 && Number.isFinite(Date.parse(item.updatedAt))).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  return `<section class="history-page" aria-labelledby="history-title"><div class="catalog-heading history-heading"><span class="section-index">04 / 06</span><h1 id="history-title">${t("history")}<em>.</em></h1><p>${t("historyDescription")}</p></div>
  <div class="history-stats" aria-label="${escapeHtml(t("historyWatchTime"))}">${stats.map(([key, label]) => `<article class="history-stat"><span>${t(label)}</span><strong>${formatWatchTime(totals[key])}</strong></article>`).join("")}</div>
  <div class="history-list-heading"><div><span class="eyebrow">${t("historyActivity")}</span><h2>${t("historyRecent")}</h2></div><span class="history-count">${sessions.length}</span></div>
  ${historyBusy ? `<p class="history-message" role="status">${t("historyLoading")}</p>` : historyError ? `<p class="history-message" role="alert">${t("historyError")}</p>` : sessions.length ? `<div class="history-list">${sessions.map((item) => `<article class="history-card">${imageTag(item.image, null, WIDE_PLACEHOLDER, 'class="history-art" loading="lazy"')}<div class="history-copy"><span class="history-episode">${t("episode")} ${item.episode}${item.episodeTitle ? ` \xB7 ${escapeHtml(item.episodeTitle)}` : ""}</span><h3>${escapeHtml(item.title || `Anime #${item.anilistId}`)}</h3><time datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(dateFormat.format(new Date(item.updatedAt)))}</time></div><div class="history-meta"><span class="history-duration">${formatWatchTime(item.watchedSeconds)}</span><span class="history-state">${t(item.completed ? "historyCompleted" : "historyInterrupted")}</span></div></article>`).join("")}</div>` : `<div class="history-empty"><span aria-hidden="true">\u25F7</span><p>${t("historyEmpty")}</p></div>`}
</section>`;
}
function animateHistory() {
  if (reduceMotion.matches || historyBusy || historyError) return;
  const stats = content.querySelectorAll(".history-stat");
  const cards = content.querySelectorAll(".history-card");
  gsap.timeline({ defaults: { ease: "power2.out" } }).fromTo(stats, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.42, stagger: 0.07, clearProps: "all" }).fromTo(cards, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.42, stagger: 0.055, clearProps: "all" }, "-=.18");
}
var updates = createUpdates({api:window.animeBloo,t,language:()=>language,escape:escapeHtml,gsap,reduced:reduceMotion,banner:displayUpdate});
function placeholderMarkup(page) {
  const previewButton = page === "update" && window.animeBloo.isDevelopment ? `<button class="update-preview-button" type="button" data-preview-update>${t("previewUpdateBanner")}</button>` : "";
  return `<section class="placeholder" aria-labelledby="placeholder-title">
  <span class="section-index">${pageNumbers[page]} / 06</span><h1 id="placeholder-title">${t(page)}<em>.</em></h1>
  <p>${t(pageNotes[page])}</p>${previewButton}
</section>`;
}
function bookmarksMarkup() {
  const tabs = [["favorite", "bookmarkFavorite"], ["likes", "bookmarkLikes"], ["planning", "bookmarkPlanning"]];
  const items = bookmarks[bookmarkTab] || [];
  return `<section class="bookmarks-page" aria-labelledby="bookmarks-title"><div class="catalog-heading"><span class="section-index">03 / 06</span><h1 id="bookmarks-title">${t("bookmarks")}<em>.</em></h1><p>${t("bookmarksNote")}</p></div>
  <div class="bookmark-tabs" role="tablist" aria-label="${escapeHtml(t("bookmarks"))}"><span class="bookmark-indicator" aria-hidden="true"></span>${tabs.map(([id, label]) => `<button type="button" role="tab" class="bookmark-tab${id === bookmarkTab ? " is-active" : ""}" data-bookmark-tab="${id}" aria-selected="${id === bookmarkTab}" aria-controls="bookmark-panel" id="bookmark-tab-${id}">${t(label)}</button>`).join("")}</div>
  <div id="bookmark-panel" role="tabpanel" aria-labelledby="bookmark-tab-${bookmarkTab}" class="bookmark-panel"><p class="bookmark-status" role="status">${bookmarkBusy ? t("bookmarkLoading") : bookmarkError ? t("bookmarkSyncError") : ""}</p>${items.length ? `<div class="bookmark-grid">${items.map((anime) => `<article class="bookmark-card"><div class="bookmark-art">${imageTag(anime.cover, null, COVER_PLACEHOLDER, 'loading="lazy"')}${Number.isFinite(anime.score) ? `<span class="bookmark-score">\u2605 ${anime.score}%</span>` : ""}<div class="bookmark-actions"><button type="button" data-open-bookmark="${anime.id}" aria-label="${escapeHtml(t("watchNow"))}: ${escapeHtml(animeTitle(anime))}" title="${escapeHtml(t("watchNow"))}">\u25B6</button>${bookmarkTab !== "planning" ? `<button type="button" data-remove-bookmark="${anime.id}" aria-label="${escapeHtml(t("bookmarkRemove"))}: ${escapeHtml(animeTitle(anime))}" title="${escapeHtml(t("bookmarkRemove"))}" aria-pressed="true">${favoriteIcon}</button>` : ""}</div></div><h2>${escapeHtml(animeTitle(anime))}</h2></article>`).join("")}</div>` : !bookmarkBusy ? `<div class="bookmark-empty">${favoriteIcon}<p>${t(bookmarkTab === "planning" ? "bookmarkPlanningEmpty" : "bookmarkEmpty")}</p></div>` : ""}</div></section>`;
}
function positionBookmarkIndicator(animated = false) {
  const tabs = content.querySelector(".bookmark-tabs");
  const selected = tabs?.querySelector(".bookmark-tab.is-active");
  const indicator = tabs?.querySelector(".bookmark-indicator");
  if (!selected || !indicator) return;
  gsap.killTweensOf(indicator);
  const vars = { x: selected.offsetLeft, width: selected.offsetWidth, duration: 0.34, ease: "power3.inOut", overwrite: "auto" };
  if (animated && !reduceMotion.matches) gsap.to(indicator, vars);
  else gsap.set(indicator, vars);
}
async function loadBookmarks() {
  if (!profile) return;
  bookmarkBusy = true;
  bookmarkError = false;
  if (currentPage === "bookmarks") renderPage();
  try {
    bookmarks = await window.animeBloo.getBookmarks();
    if (currentPage === "bookmarks") renderPage();
    try {
      bookmarks = await window.animeBloo.syncPlanning();
    } catch {
      bookmarkError = true;
    }
  } catch {
    bookmarkError = true;
  }
  bookmarkBusy = false;
  if (currentPage === "bookmarks") renderPage();
}
function changeBookmarkTab(next) {
  if (!["favorite", "likes", "planning"].includes(next) || next === bookmarkTab) return;
  const panel = content.querySelector(".bookmark-panel");
  const oldX = content.querySelector(".bookmark-tab.is-active")?.offsetLeft || 0;
  gsap.killTweensOf(panel);
  const replace = () => {
    bookmarkTab = next;
    renderPage();
    const indicator = content.querySelector(".bookmark-indicator");
    const target = content.querySelector(".bookmark-tab.is-active");
    if (indicator && target && !reduceMotion.matches) {
      gsap.set(indicator, { x: oldX, width: target.offsetWidth });
      gsap.to(indicator, { x: target.offsetLeft, duration: 0.34, ease: "power3.inOut", overwrite: "auto" });
    }
    const nextPanel = content.querySelector(".bookmark-panel");
    if (!reduceMotion.matches) gsap.fromTo(nextPanel, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: "power2.out", clearProps: "all" });
    content.querySelector(`[data-bookmark-tab="${next}"]`)?.focus();
  };
  if (reduceMotion.matches) replace();
  else gsap.to(panel, { y: -8, autoAlpha: 0, duration: 0.14, ease: "power2.in", onComplete: replace });
}
async function toggleLocalBookmark(category, anime, button) {
  if (!anime || button.disabled) return;
  button.disabled = true;
  try {
    const result = await window.animeBloo.toggleBookmark(category, anime);
    bookmarks = result.bookmarks;
    if (currentPage === "bookmarks") {
      const card = button.closest(".bookmark-card");
      if (card && !reduceMotion.matches) gsap.to(card, { scale: 0.94, autoAlpha: 0, duration: 0.2, ease: "power2.in", onComplete: () => {
        if (currentPage === "bookmarks") renderPage();
      } });
      else renderPage();
    } else if (button.matches("[data-favorite]")) {
      button.classList.toggle("is-favorite", result.selected);
      button.setAttribute("aria-pressed", String(result.selected));
      button.querySelector(".favorite-label").textContent = t(result.selected ? "removeFavorite" : "addFavorite");
      if (result.selected) animateFavoriteIcon(button);
    } else {
      if (result.selected) animateFavoriteIcon(button);
      content.querySelectorAll(`[data-toggle-detail="${category}"]`).forEach((action) => action.setAttribute("aria-pressed", String(result.selected)));
    }
  } catch {
    button.title = t("catalogError");
  } finally {
    button.disabled = false;
  }
}
function searchMarkup() {
  const header = `<section class="catalog-page"><div class="catalog-heading"><span class="section-index">02 / 06</span><h1>${t("search")}<em>.</em></h1><p>${t("searchNote")}</p></div>`;
  const searchBox = `<label class="catalog-search-label" for="catalog-search">${t("searchAnime")}</label><input id="catalog-search" class="catalog-search" type="text" autocomplete="off" value="${escapeHtml(searchTerm)}" placeholder="${escapeHtml(t("searchPlaceholder"))}" />`;
  if (selectedId) {
    const backLabel = animeReturnPage === "search" ? t("backToResults") : t(animeReturnPage);
    const back = `<button class="catalog-back" type="button" data-catalog-back><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3m4-4L3 8l4 4"/></svg><span>${backLabel}</span></button>`;
    if (catalogBusy) return `${header}${back}<p class="catalog-message">${t("loadingAnime")}</p></section>`;
    if (catalogError || !selectedAnime) return `${header}${back}<p class="catalog-message">${t("catalogError")}</p></section>`;
    const anime = selectedAnime;
    const displayEpisodes = anime.episodes.map((episode) => ({ ...episode, summary: cleanSynopsis(episode.summary) }));
    const episodes = displayEpisodes.length ? displayEpisodes.map((episode) => { const record = watchProgress[`${anime.id}:${episode.number}`]; const progress = record?.status === 'completed' || record?.duration > 0 && record.seconds / record.duration >= .9 ? 100 : record?.duration > 0 ? Math.min(100, Math.max(0, record.seconds / record.duration * 100)) : 0; return `<button class="episode-card" type="button" data-play-episode="${episode.number}" ${streamBusy ? "disabled" : ""}>${imageTag([episode.aniZipThumbnail, episode.kitsuThumbnail, episode.scraperThumbnail, anime.banner], anime.cover, WIDE_PLACEHOLDER, 'loading="lazy"')}<span class="episode-copy"><span>${t("episode")} ${episode.number}${episode.absoluteNumber && episode.absoluteNumber !== episode.number ? ` \xB7 #${episode.absoluteNumber}` : ""}</span><strong>${escapeHtml(episode.title)}</strong>${episode.summary ? `<span class="episode-summary" title="${escapeHtml(episode.summary)}">${escapeHtml(truncate(episode.summary, 220))}</span>` : ""}</span>${episode.duration || anime.duration ? `<span class="episode-duration">${escapeHtml(String(episode.duration || anime.duration))}m</span>` : ""}${progress > 0 ? `<span class="episode-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>` : ""}</button>`; }).join("") : `<p class="catalog-message">${t("episodesUnavailable")}</p>`;
    const player = playerOpen ? `<div class="stream-player"><div class="player-top-hud"><button type="button" class="player-back" data-close-player aria-label="${t("backToResults")}">${playerIcon('back')}</button>${streamPanelMarkup(anime)}</div><span class="stream-mode-playback-notice" data-stream-mode-playback-notice role="status" aria-live="polite"></span><div class="video-stage"><video playsinline preload="auto" crossorigin="anonymous"></video><canvas class="upscale-canvas" hidden aria-hidden="true"></canvas><button type="button" class="aniskip-button" data-aniskip hidden disabled aria-keyshortcuts="S Tab"><span data-aniskip-label></span><kbd>S</kbd></button><div class="player-feedback" aria-hidden="true"></div><div class="upscale-playback-controls"><div class="player-timeline"><div class="player-buffer" data-video-buffer aria-hidden="true"></div><div class="player-played" aria-hidden="true"></div><input type="range" data-video-seek min="0" max="1000" value="0" aria-label="${t("seek")}" /></div><div class="player-control-row"><div class="player-control-group"><button type="button" data-video-play aria-label="${t("pause")}">${playerIcon('pause')}</button><button type="button" data-video-rewind aria-label="-10s">${playerIcon('rewind')}</button><button type="button" data-video-forward aria-label="+10s">${playerIcon('forward')}</button><span data-video-elapsed class="player-time">0:00</span></div><div class="player-control-group"><span data-video-remaining class="player-time">-0:00</span><button type="button" data-video-next hidden aria-label="${t("episode")}">${playerIcon('next')}</button><button type="button" data-video-mute aria-label="${t("mute")}">${playerIcon('volume')}</button><button type="button" data-video-fullscreen aria-label="${t("fullscreen")}">${playerIcon('fullscreen')}</button></div></div></div></div><div class="player-loading" role="status" aria-label="${t("loadingAnime")}"><span></span></div></div>` : "";
    const firstEpisode = targetEpisode(anime).number;
    const badges = [anime.year ? `${anime.season || ""} ${anime.year}`.trim() : null, anime.duration ? `${anime.duration}m` : null, anime.score !== null ? `\u2605 ${(anime.score / 10).toFixed(1)}` : null, anime.status].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
    const description = cleanSynopsis(anime.description);
    const synopsis = truncate(description, 240);
    const saveActions = `<div class="detail-actions"><button class="detail-watch" type="button" data-play-episode="${firstEpisode}" ${streamBusy ? "disabled" : ""}><svg class="detail-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z"/></svg><span>${escapeHtml(episodeAction(anime))}</span></button><div class="detail-list-menu"><button class="detail-outline" type="button" data-list-toggle aria-haspopup="true" aria-expanded="false"><span>${t("addToList")}</span><svg class="detail-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg></button><div class="detail-list-options" hidden><button type="button" data-toggle-detail="favorite" aria-pressed="${bookmarks.favorite.some((item) => item.id === anime.id)}">${favoriteIcon}<span>${t("bookmarkFavorite")}</span></button><button type="button" data-toggle-detail="planning" aria-pressed="${bookmarks.planning.some((item) => item.id === anime.id)}">${t("bookmarkPlanning")}</button></div></div><button class="detail-outline detail-heart" type="button" data-toggle-detail="likes" aria-label="${t("bookmarkLikes")}" aria-pressed="${bookmarks.likes.some((item) => item.id === anime.id)}">${favoriteIcon}</button></div>`;
    return `<section class="catalog-page"><article class="anime-detail"><div class="detail-banner">${imageTag(anime.banner, anime.cover, WIDE_PLACEHOLDER, 'class="detail-banner-art"')}<div class="detail-main">${back}<div class="detail-copy"><h2>${escapeHtml(animeTitle(anime))}</h2><p class="detail-synopsis" title="${escapeHtml(description)}">${escapeHtml(synopsis)}</p>${description.length > synopsis.length ? `<button class="detail-read-more" type="button" data-read-more>${t("readMore")}</button>` : ""}<div class="detail-badges">${badges}</div>${saveActions}</div>${imageTag(anime.cover, null, COVER_PLACEHOLDER, 'class="detail-cover"')}</div></div></article><div class="detail-language-bar">${streamPanelMarkup(anime)}</div><p class="catalog-message" role="alert">${escapeHtml(streamError)}</p>${player}<h2 class="episodes-heading">${t("episodes")}</h2><div class="episode-list">${episodes}</div></section>`;
  }
  const status2 = catalogBusy ? t("searchingAnime") : catalogError ? t("catalogError") : searchTerm.trim().length < 2 ? t("searchHint") : searchResults.length ? "" : t("noResults");
  return `${header}${searchBox}<p class="catalog-message" role="status">${status2}</p><div class="anime-results">${searchResultCards()}</div></section>`;
}
function searchResultCards() {
  return searchResults.map((anime) => `<button class="anime-result" type="button" data-anime-id="${anime.id}">${imageTag(anime.cover, null, COVER_PLACEHOLDER, 'loading="lazy"')}<span>${escapeHtml(animeTitle(anime))}</span></button>`).join("");
}
function updateSearchResults() {
  const message = content.querySelector(".catalog-message");
  const results = content.querySelector(".anime-results");
  if (message) message.textContent = catalogError ? t("catalogError") : searchTerm.trim().length < 2 ? t("searchHint") : searchResults.length ? "" : t("noResults");
  if (results) results.innerHTML = searchResultCards();
}
async function runSearch(term) {
  if (currentPage !== "search" || selectedId) return;
  const request = ++catalogRequest;
  const query = term.trim();
  selectedId = null;
  selectedAnime = null;
  episodeTrackDiscovery = null;
  catalogError = false;
  if (query.length < 2) {
    searchResults = [];
    catalogBusy = false;
    updateSearchResults();
    return;
  }
  catalogBusy = true;
  const message = content.querySelector(".catalog-message");
  if (message) message.textContent = t("searchingAnime");
  try {
    const results = await window.animeBloo.searchAnime(query);
    if (request !== catalogRequest) return;
    searchResults = results;
  } catch {
    if (request !== catalogRequest) return;
    catalogError = true;
    searchResults = [];
  } finally {
    if (request === catalogRequest) {
      catalogBusy = false;
      if (currentPage === "search") updateSearchResults();
    }
  }
}
async function openAnime(id, autoplay = false, returnPage = "search") {
  if (playerOpen) closePlayer(false);
  const request = ++catalogRequest;
  animeReturnPage = returnPage;
  selectedId = id;
  selectedAnime = null;
  availableStreamEpisodes = null;
  episodeAvailabilityLoading = false;
  ++episodeAvailabilityGeneration;
  playingEpisode = null;
  streamError = "";
  catalogBusy = true;
  catalogError = false;
  renderPage();
  main.scrollTop = 0;
  try {
    const [anime, progress] = await Promise.all([window.animeBloo.getAnime(id, language), window.animeBloo.getWatchHistory()]);
    if (request !== catalogRequest) return;
    watchProgress = progress;
    selectedAnime = anime;
    catalogError = !anime;
  } catch {
    if (request === catalogRequest) catalogError = true;
  } finally {
    if (request === catalogRequest) {
      catalogBusy = false;
      if (currentPage === "search") {
        renderPage();
        if (selectedAnime) { prefetchSelectedEpisode(); discoverEpisodeTracks(targetEpisode(selectedAnime).number); refreshEpisodeAvailability(); }
        const selector = content.querySelector('[data-stream-mode-selector]');
        if (selector && !reduceMotion.matches) gsap.fromTo(selector, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: .28, ease: 'power2.out', overwrite: 'auto' });
      }
      if (autoplay && currentPage === "search" && selectedAnime?.episodes.length) playEpisode(targetEpisode(selectedAnime).number);
    }
  }
}
async function playEpisode(number) {
  if (!selectedAnime || !selectedAnime.year) return;
  const prefetched = nextEpisodePrefetch?.anime === selectedAnime && nextEpisodePrefetch.number === number && nextEpisodePrefetch.mode === preferredStreamMode() && Date.now() - nextEpisodePrefetch.created < 4 * 60 * 1000 ? nextEpisodePrefetch.promise : null;
  if (playerOpen) closePlayer(false, Boolean(prefetched));
  nextEpisodePrefetch = null;
  playerOpen = true;
  discoverEpisodeTracks(number);
  playerClosing = false;
  failedProviders = []; failedSources.clear(); fallbackResume = null;
  streamError = '';
  renderPage();
  showPlayerHud();
  // Both requests happen in the activation turn, before any network operation.
  content.querySelector('.stream-player')?.requestFullscreen?.().catch(() => {});
  window.animeBloo.setPlayerFullscreen?.(true).catch(() => {});
  await resolveNextProvider(number, prefetched);
}
async function resolveNextProvider(number, prefetched = null) {
  const generation = ++playbackGeneration;
  const anime = selectedAnime;
  streamBusy = true;
  setPlayerLoading(true);
  try {
    let response = prefetched ? await prefetched : null;
    if (!playerOpen || generation !== playbackGeneration || selectedAnime !== anime) return;
    const requestedMode = preferredStreamMode(anime);
    if (response?.status === 'ok' && (response.result?.mode !== requestedMode || response.result?.stream?.mode !== requestedMode)) response = null;
    if (response?.status !== 'ok') response = await window.animeBloo.resolveStream({ anilistId: anime.id, title: anime.title?.romaji || anime.title?.english || animeTitle(anime), year: anime.year, episode: number, mode: requestedMode, audioLang: streamPreferences(anime).audioLang, excludeProviders: failedProviders });
    if (!playerOpen || generation !== playbackGeneration || selectedAnime !== anime) return;
    if (response?.status !== 'ok' || response.result?.mode !== requestedMode || response.result?.stream?.mode !== requestedMode) throw new Error('Unavailable');
    failedProviders.push(response.result.provider);
    const saved = latestProgress(anime.id);
    playingEpisode = { number, provider: response.result.provider, mode: response.result.mode, ...response.result.stream, sources: response.result.sources || [response.result.stream] };
    const resume = !fallbackResume && saved?.episode === number && saved.status !== 'completed' && saved.seconds > 0 && (!saved.duration || saved.seconds / saved.duration < .9) ? { time: saved.seconds, playing: true } : fallbackResume;
    const episode = anime.episodes.find(entry => entry.number === number);
    if (episode) episode.scraperThumbnail = remoteImage(response.result.artwork);
    qualityMode = 'auto';
    upscaleUnavailable = false;
    const video = content.querySelector('.stream-player video');
    attachStream(video, playingEpisode, resume);
    refreshStreamPreferences();
    fallbackResume = null;
    if (!resume) saveCurrentProgress(video);
  } catch {
    if (generation !== playbackGeneration || !playerOpen) return;
    closePlayer(false);
    streamError = t('streamUnavailable');
    renderPage();
  } finally { if (generation === playbackGeneration) streamBusy = false; }
}
async function failStream(video, source) {
  if (!playerOpen || streamBusy || !video.isConnected || playingEpisode?.url !== source.url || failedSources.has(source.url)) return;
  failedSources.add(source.url);
  clearTimeout(streamLoadTimer);
  fallbackResume = { time: video.currentTime || fallbackResume?.time || 0, playing: true };
  video.pause();
  hlsPlayer?.destroy(); hlsPlayer = null;
  setPlayerLoading(true);
  const next = playingEpisode.sources.find(item => item.mode === preferredStreamMode() && !failedSources.has(item.url));
  if (next) { Object.assign(playingEpisode, next); attachStream(video, next, fallbackResume); refreshStreamPreferences(); fallbackResume = null; }
  else await resolveNextProvider(playingEpisode.number);
}
function settingsMarkup() {
  const safeName = profile.name.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const avatarUrl = /^https:\/\//i.test(profile.avatar) ? profile.avatar.replace(/&/g, "&amp;").replace(/"/g, "&quot;") : "";
  return `<section class="settings-page" aria-labelledby="settings-title">
  <div class="settings-intro"><span class="section-index">06 / 06</span><h1 id="settings-title">${t("settings")}<em>.</em></h1><p>${t("settingsNote")}</p></div>
  <div class="settings-card account-card"><div class="account-identity"><img class="account-avatar" src="${avatarUrl}" alt="" referrerpolicy="no-referrer" /><div class="settings-copy"><h2>${t("accountTitle")}</h2><strong class="account-name">${safeName}</strong><p class="account-description">${t("accountDescription")}</p></div></div><button class="settings-action logout-button" type="button" data-logout>${t("logout")}</button></div>
  <div class="settings-card theme-card"><div class="settings-copy"><h2>${t("themeTitle")}</h2><p>${t("themeDescription")}</p></div>
    <div class="theme-switcher" role="group" aria-label="${t("themeTitle")}"><span class="theme-indicator" aria-hidden="true"></span>
      ${[["light", "themeLight", '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'], ["dark", "themeDark", '<path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5 8.5 8.5 0 1 0 20.5 14.3Z"/>'], ["system", "themeSystem", '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>']].map(([mode, label, icon]) => `<button class="theme-option${theme === mode ? " is-selected" : ""}" type="button" data-theme-option="${mode}" aria-pressed="${theme === mode}"><svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span>${t(label)}</span></button>`).join("")}
    </div>
  ${appearanceMarkup(language)}
</div>
  <div class="settings-card language-card"><div class="settings-copy"><h2>${t("language")}</h2><p>${t("languageDescription")}</p></div>
    <div class="language-picker"><button class="language-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${t("chooseLanguage")}: ${languageNames[language]}"><span class="language-current">${languageNames[language]}</span><svg class="language-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 5.5 5 5 5-5"/></svg></button>
    <div class="language-menu" role="listbox" aria-label="${t("languageMenu")}" hidden>${Object.entries(languageNames).map(([code, name]) => `<button class="language-option${code === language ? " is-selected" : ""}" type="button" role="option" aria-selected="${code === language}" data-language="${code}">${name}</button>`).join("")}</div></div>
  </div>
  <div class="settings-card upscale-card${upscaleSettings.enabled ? " is-enabled" : ""}"><div class="settings-copy"><h2>${t("upscaleTitle")} <span class="upscale-beta">BETA</span></h2><p>${t("upscaleDescription")}</p><small class="upscale-credit">Anime4K by bloc97</small></div>
    <div class="upscale-actions"><label class="upscale-switch"><input type="checkbox" data-upscale-toggle ${upscaleSettings.enabled ? "checked" : ""} aria-label="${t("upscaleEnable")}" /><span class="upscale-switch-track" aria-hidden="true"><span></span></span><span>${t("upscaleEnable")}</span></label>
      <div class="upscale-picker"><button type="button" class="upscale-trigger" data-upscale-menu-toggle aria-haspopup="listbox" aria-expanded="false" aria-label="${t("upscaleProfile")}: ${t(`upscale${upscaleSettings.profile[0].toUpperCase()}${upscaleSettings.profile.slice(1)}`)}"><span data-upscale-current>${t(`upscale${upscaleSettings.profile[0].toUpperCase()}${upscaleSettings.profile.slice(1)}`)}</span><svg class="upscale-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 5.5 5 5 5-5"/></svg></button>
        <div class="upscale-menu" data-upscale-menu role="listbox" aria-label="${t("upscaleProfile")}" hidden>${Object.keys(UPSCALE_PROFILES).map((id) => `<button type="button" class="upscale-option${id === upscaleSettings.profile ? " is-selected" : ""}" data-upscale-profile="${id}" role="option" aria-selected="${id === upscaleSettings.profile}">${t(`upscale${id[0].toUpperCase()}${id.slice(1)}`)}<span aria-hidden="true">${id === upscaleSettings.profile ? "\u2713" : ""}</span></button>`).join("")}</div></div></div>
  </div>
  <div class="settings-card aniskip-card"><div class="settings-copy"><h2>${t("autoSkipTitle")}</h2><p>${t("autoSkipDescription")}</p></div><label class="upscale-switch"><input type="checkbox" data-auto-skip ${readAutoSkip() ? "checked" : ""} aria-label="${t("autoSkipTitle")}" /><span class="upscale-switch-track" aria-hidden="true"><span></span></span><span>${t("autoSkipEnable")}</span></label></div>
  <div class="settings-card cache-card"><div class="settings-copy"><h2>${t("cacheTitle")}: <strong class="cache-size" data-cache-size>${t("cacheCalculating")}</strong></h2><p>${t("cacheDescription")}</p></div>
    <button class="settings-action cache-button" type="button" data-clear-cache><span class="cache-button-label">${t("clearCache")}</span></button>
  </div><p class="cache-status" role="status" aria-live="polite"></p><p class="settings-error" role="alert" hidden></p>
</section>`;
}
function refreshQualityMenu() {
  const menu = content.querySelector("[data-quality-menu]");
  if (!menu) return;
  menu.replaceChildren();
  const choices = [{ id: "auto", label: t("videoQualityAuto") }, ...availableQualities];
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.quality = choice.id;
    button.textContent = choice.label;
    button.setAttribute("aria-current", String(qualityMode === choice.id));
    menu.append(button);
  }
  const current = content.querySelector("[data-quality-current]");
  if (current) current.textContent = choices.find((item) => item.id === qualityMode)?.label || t("videoQualityAuto");
}
function persistUpscaling() {
  try {
    localStorage.setItem(upscaleStorageKey, JSON.stringify(upscaleSettings));
  } catch {
  }
}
function updateUpscalePlayback() {
  const video = content.querySelector(".stream-player video");
  const controls = content.querySelector(".upscale-playback-controls");
  if (!video || !controls) return;
  const active = video.classList.contains("is-upscaled");
  controls.hidden = false;
  video.controls = false;
  const play = controls.querySelector("[data-video-play]");
  play.innerHTML = playerIcon(video.paused ? 'play' : 'pause');
  play.setAttribute("aria-label", t(video.paused ? "play" : "pause"));
  const seek = controls.querySelector("[data-video-seek]");
  if (Number.isFinite(video.duration) && video.duration > 0) seek.value = String(Math.round(video.currentTime / video.duration * 1e3));
  const timeline = controls.querySelector('.player-timeline');
  timeline?.style.setProperty('--played', `${Number(seek.value) / 10}%`);
  const buffer = controls.querySelector('[data-video-buffer]');
  if (buffer) {
    const ranges = bufferedRanges(video.buffered, video.duration);
    while (buffer.children.length > ranges.length) buffer.lastElementChild.remove();
    ranges.forEach((range, index) => {
      const bar = buffer.children[index] || buffer.appendChild(document.createElement('span'));
      bar.style.left = `${range.start}%`; bar.style.width = `${range.width}%`;
    });
  }
  const next = controls.querySelector('[data-video-next]');
  if (next) { const number = nextEpisodeNumber(); next.hidden = !number; next.setAttribute('aria-label', `${t('episode')} ${number || ''}`); }
  controls.querySelector("[data-video-elapsed]").textContent = formatPlaybackTime(video.currentTime);
  controls.querySelector("[data-video-remaining]").textContent = `-${formatPlaybackTime(Math.max(0, (Number.isFinite(video.duration) ? video.duration : 0) - video.currentTime))}`;
  const mute = controls.querySelector("[data-video-mute]");
  mute.innerHTML = playerIcon(video.muted ? 'muted' : 'volume');
  mute.setAttribute("aria-label", t(video.muted ? "unmute" : "mute"));
  const fullscreen = controls.querySelector('[data-video-fullscreen]');
  fullscreen.innerHTML = playerIcon(document.fullscreenElement ? 'shrink' : 'fullscreen');
}
function setupUpscaling(video) {
  upscaleRenderer?.dispose();
  upscaleRenderer = null;
  if (!video) return;
  const status2 = content.querySelector(".upscale-player-status");
  if (!upscaleSettings.enabled || upscaleUnavailable) {
    if (status2) status2.textContent = "";
    updateUpscalePlayback();
    return;
  }
  const oldCanvas = content.querySelector(".upscale-canvas");
  const canvas = oldCanvas.cloneNode(false);
  oldCanvas.replaceWith(canvas);
  if (status2) status2.textContent = "";
  upscaleRenderer = mountUpscaling(video, canvas, upscaleSettings.profile, () => {
    upscaleUnavailable = true;
    upscaleRenderer = null;
    if (status2?.isConnected) status2.textContent = "";
    updateUpscalePlayback();
  }, () => { if (status2) status2.textContent = ""; updateUpscalePlayback(); });
  video.addEventListener("timeupdate", updateUpscalePlayback);
  video.addEventListener("play", updateUpscalePlayback);
  video.addEventListener("pause", updateUpscalePlayback);
  video.addEventListener("loadedmetadata", updateUpscalePlayback);
}
function changeUpscaling(enabled, profile2) {
  if (typeof enabled === 'boolean') profile2 = enabled ? (upscaleSettings.profile === 'off' ? 'balanced' : upscaleSettings.profile) : 'off';
  upscaleSettings = normalizeUpscaling({ profile: profile2 || upscaleSettings.profile });
  persistUpscaling();
  const playerPicker = content.querySelector("[data-player-upscale]");
  if (playerPicker) playerPicker.value = upscaleSettings.profile;
  const card = content.querySelector(".upscale-card");
  if (card) {
    card.classList.toggle("is-enabled", upscaleSettings.enabled);
    const toggle = card.querySelector("[data-upscale-toggle]");
    toggle.checked = upscaleSettings.enabled;
    const label = t(`upscale${upscaleSettings.profile[0].toUpperCase()}${upscaleSettings.profile.slice(1)}`);
    card.querySelector("[data-upscale-current]").textContent = label;
    card.querySelector(".upscale-trigger").setAttribute("aria-label", `${t("upscaleProfile")}: ${label}`);
    card.querySelectorAll("[data-upscale-profile]").forEach((option) => {
      const selected = option.dataset.upscaleProfile === upscaleSettings.profile;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
      option.querySelector("span").textContent = selected ? "\u2713" : "";
    });
    if (!reduceMotion.matches) {
      gsap.fromTo(card, { borderColor: "var(--accent-color)", scale: 1.008 }, { borderColor: "", scale: 1, duration: 0.42, ease: "power2.out", clearProps: "borderColor,transform", overwrite: "auto" });
      gsap.fromTo(card.querySelector(".upscale-trigger"), { scale: 0.97, autoAlpha: 0.72 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "power2.out", clearProps: "all", overwrite: "auto" });
    }
  }
  const video = content.querySelector(".stream-player video");
  if (video) {
    upscaleUnavailable = false;
    setupUpscaling(video);
  }
}
function attachStream(video, source, resume = null) {
  const shouldAutoPlay = resume ? resume.playing : true;
  video.querySelectorAll('track').forEach(track => track.remove());
  (source.subtitles || []).forEach((track, index) => {
    const node = document.createElement('track');
    node.kind = 'subtitles';
    node.label = cleanVisibleLabel(track.language || 'Subtitles') || 'Subtitles';
    node.srclang = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(track.language) ? track.language : 'und';
    node.src = track.url;
    node.default = !!track.default || index === 0;
    video.append(node);
  });
  upscaleUnavailable = false;
  setupUpscaling(video);
  disposeAniSkip?.();
  disposeAniSkip = mountAniSkip(video, { anime: selectedAnime, episode: playingEpisode?.number, translate: t, reducedMotion: reduceMotion });
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  availableQualities = [];
  const restore = () => {
    if (!resume) return;
    try {
      video.currentTime = Math.min(resume.time, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : resume.time);
    } catch {
    }
    if (resume.playing) video.play().catch(() => {
    });
    resume = null;
  };
  video.onloadedmetadata = () => { restore(); refreshStreamPreferences(); applyStreamTracks(video); };
  clearTimeout(streamLoadTimer);
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.addEventListener('progress', updateUpscalePlayback);
  video.addEventListener('timeupdate', updateUpscalePlayback);
  video.addEventListener('durationchange', updateUpscalePlayback);
  video.addEventListener('emptied', updateUpscalePlayback);
  video.addEventListener('volumechange', updateUpscalePlayback);
  video.addEventListener('play', updateUpscalePlayback);
  video.addEventListener('pause', updateUpscalePlayback);
  video.addEventListener('loadedmetadata', updateUpscalePlayback);
  video.onplay = showPlayerHud;
  video.onpause = showPlayerHud;
  updateUpscalePlayback();
  let failed = false;
  const fail = () => { if (!failed) { failed = true; failStream(video, source); } };
  const arm = () => {
    clearTimeout(streamLoadTimer);
    if (playerOpen && !video.ended) { setPlayerLoading(true); streamLoadTimer = setTimeout(fail, 8000); }
  };
  video.onerror = fail;
  video.onwaiting = arm;
  video.onstalled = arm;
  video.onplaying = () => { clearTimeout(streamLoadTimer); setPlayerLoading(false); };
  video.oncanplay = () => { clearTimeout(streamLoadTimer); setPlayerLoading(false); if (shouldAutoPlay) video.play().catch(() => {}); };
  arm();
  if (source.type === "hls" && Hls.isSupported()) {
    video.removeAttribute("src");
    const player = new Hls({ ...HLS_BUFFER_CONFIG, startLevel: -1 });
    hlsPlayer = player;
    player.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      if (hlsPlayer !== player) return;
      const levels = data.levels || player.levels;
      const byHeight = /* @__PURE__ */ new Map();
      levels.forEach((level, index) => {
        if (!level.height) return;
        const previous = byHeight.get(level.height);
        if (!previous || level.bitrate > previous.bitrate) byHeight.set(level.height, { index, bitrate: level.bitrate });
      });
      availableQualities = [...byHeight].sort((a, b) => b[0] - a[0]).map(([height, value]) => ({ id: `hls:${value.index}`, label: `${height}p` }));
      availableQualities.push(...(playingEpisode?.sources || []).filter((item) => item.type === "mp4" && item.height).map((item) => ({ id: `source:${item.url}`, label: `${item.height}p \xB7 MP4`, url: item.url })));
      if (qualityMode === "auto" && levels.length) {
        const highest = levels.reduce((best, level, index) => level.bitrate > levels[best].bitrate ? index : best, 0);
        player.currentLevel = highest;
      } else if (qualityMode.startsWith("hls:")) player.currentLevel = Number(qualityMode.slice(4));
      refreshQualityMenu();
    });
    player.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => { refreshStreamPreferences(); applyStreamTracks(video); });
    player.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => { refreshStreamPreferences(); applyStreamTracks(video); });
    player.on(Hls.Events.ERROR, (_, data) => { if (hlsPlayer === player && data.fatal) fail(); });
    player.attachMedia(video);
    player.loadSource(source.url);
  } else {
    if (upscaleSettings.enabled && !upscaleUnavailable) video.crossOrigin = "anonymous";
    video.src = source.url;
    availableQualities = (playingEpisode?.sources || []).filter((item) => item.type === "mp4" && item.height).map((item) => ({ id: `source:${item.url}`, label: `${item.height}p`, url: item.url }));
    refreshQualityMenu();
    video.load();
  }
}
function changeVideoQuality(id) {
  const video = content.querySelector(".stream-player video");
  if (!video || !playingEpisode) return;
  const choice = availableQualities.find((item) => item.id === id);
  if (id !== "auto" && !choice) return;
  qualityMode = id;
  if (hlsPlayer && (id === "auto" || id.startsWith("hls:"))) {
    if (id === "auto") {
      const levels = hlsPlayer.levels;
      const highest = levels.reduce((best, level, index) => level.bitrate > levels[best].bitrate ? index : best, 0);
      hlsPlayer.nextAutoLevel = highest;
      hlsPlayer.loadLevel = -1;
    } else hlsPlayer.currentLevel = Number(id.slice(4));
  } else {
    const source = id === "auto" ? playingEpisode.sources[0] : playingEpisode.sources.find((item) => item.url === choice?.url);
    if (source && source.url !== video.currentSrc) attachStream(video, source, { time: video.currentTime, playing: !video.paused });
  }
  refreshQualityMenu();
  const menu = content.querySelector("[data-quality-menu]");
  if (menu) menu.hidden = true;
  content.querySelector("[data-quality-toggle]")?.setAttribute("aria-expanded", "false");
}
function renderPage() {
  clearTimeout(streamLoadTimer);
  loadingTween?.kill(); loadingTween = null;
  flushWatchSession(false, true);
  clearInterval(cacheRefreshTimer);
  cacheRefreshTimer = null;
  cacheRefreshGeneration++;
  languageMenuOpen = false;
  stopHeroSlider();
  upscaleRenderer?.dispose();
  upscaleRenderer = null;
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  disposeAniSkip?.(); disposeAniSkip = null;
  content.innerHTML = currentPage === "home" ? homeMarkup() : currentPage === "search" ? searchMarkup() : currentPage === "bookmarks" ? bookmarksMarkup() : currentPage === "history" ? historyMarkup() : currentPage === "settings" ? settingsMarkup() : currentPage === "update" ? updates.markup() : placeholderMarkup(currentPage);
  if (playerOpen) setPlayerLoading(true);
  tintLogos(content);
  if (currentPage === "update") updates.mount();
  if (currentPage === "history") animateHistory();
  if (currentPage === "home") scheduleHeroSlide();
  if (currentPage === "home" && !reduceMotion.matches) {
    const cards = content.querySelectorAll(".trending-row .home-anime-card");
    cards.forEach((card) => {
      const art = card.querySelector("img");
      card.addEventListener("mouseenter", () => gsap.to(art, { scale: 1.055, y: -5, duration: 0.34, ease: "power3.out", force3D: true, overwrite: "auto" }));
      card.addEventListener("mouseleave", () => gsap.to(art, { scale: 1, y: 0, duration: 0.38, ease: "power2.out", force3D: true, overwrite: "auto" }));
    });
  }
  refreshStreamPreferences();
  updateEpisodeAvailability();
  const video = content.querySelector(".stream-player video");
  if (video && playingEpisode) {
    upscaleUnavailable = false;
    attachStream(video, playingEpisode, null);
  }
  if (currentPage === "settings") {
    if (!reduceMotion.matches) gsap.fromTo(
      content.querySelectorAll(".settings-card"),
      { y: 12, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.045, ease: "power2.out", clearProps: "transform,opacity,visibility" }
    );
    mountAppearance(content, language, () => theme);
    requestAnimationFrame(() => positionThemeIndicator(false));
    refreshCacheSize();
    cacheRefreshTimer = setInterval(() => {
      if (!cacheBusy) refreshCacheSize();
    }, 1e4);
  }
  if (currentPage === "bookmarks") positionBookmarkIndicator(false);
}
function positionThemeIndicator(animated) {
  const switcher = content.querySelector(".theme-switcher");
  const selected = switcher?.querySelector(`[data-theme-option="${theme}"]`);
  const indicator = switcher?.querySelector(".theme-indicator");
  if (!selected || !indicator) return;
  const x = selected.offsetLeft;
  const width = selected.offsetWidth;
  gsap.killTweensOf(indicator);
  if (animated && !reduceMotion.matches) gsap.to(indicator, { x, width, duration: 0.52, ease: "back.out(1.2)", overwrite: "auto" });
  else gsap.set(indicator, { x, width });
}
function applyTheme(resolved, animateColors = true) {
  if (document.documentElement.dataset.theme === resolved) return;
  clearTimeout(themeTransitionTimer);
  if (animateColors && !reduceMotion.matches) document.documentElement.classList.add("theme-transition");
  document.documentElement.dataset.theme = resolved;
  applyAccent();
  themeTransitionTimer = setTimeout(() => document.documentElement.classList.remove("theme-transition"), 360);
}
async function changeTheme(nextTheme) {
  if (!["light", "dark", "system"].includes(nextTheme) || theme === nextTheme) return;
  const previous = theme;
  theme = nextTheme;
  content.querySelectorAll(".theme-option").forEach((button) => {
    const active = button.dataset.themeOption === theme;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  positionThemeIndicator(true);
  const icon = content.querySelector(`[data-theme-option="${theme}"] .theme-icon`);
  if (icon && !reduceMotion.matches) gsap.fromTo(icon, { scale: 0.76, rotation: theme === "light" ? -28 : theme === "dark" ? 15 : 0 }, { scale: 1, rotation: 0, duration: 0.55, ease: "back.out(2)", overwrite: "auto" });
  try {
    const saved = await window.animeBloo.setTheme(nextTheme);
    if (saved.mode === theme) applyTheme(saved.resolved);
  } catch {
    theme = previous;
    content.querySelectorAll(".theme-option").forEach((button) => {
      const active = button.dataset.themeOption === theme;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    positionThemeIndicator(true);
    const error = content.querySelector(".settings-error");
    if (error) {
      error.textContent = t("themeSaveError");
      error.hidden = false;
    }
  }
}
function showPage(page, onShown) {
  if (playerOpen) closePlayer(false);
  if (!profile || !pageNumbers[page] || page === currentPage) return;
  const previous = navigation.find((item) => navigationPage(item) === currentPage);
  const current = navigation.find((item) => navigationPage(item) === page);
  previous.classList.remove("is-active");
  previous.removeAttribute("aria-current");
  current.classList.add("is-active");
  current.setAttribute("aria-current", "page");
  positionNavIndicator(true);
  animate(current.querySelector(".nav-icon, .settings-icon"), { scale: 1.16, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1 });
  gsap.killTweensOf(content);
  const replace = () => {
    currentPage = page;
    renderPage();
    onShown?.();
    if (page === "home") loadHome();
    if (page === "bookmarks") loadBookmarks();
    if (page === "history") loadHistory();
    main.scrollTop = 0;
    if (!reduceMotion.matches) gsap.fromTo(content, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.34, ease: "power2.out", clearProps: "all" });
    main.focus({ preventScroll: true });
  };
  if (reduceMotion.matches) replace();
  else animate(content, { y: -8, autoAlpha: 0, duration: 0.16, ease: "power1.in", onComplete: replace });
}
function positionNavIndicator(animated = false) {
  const active = sidebar.querySelector(".nav-item.is-active, .nav-btn.is-active");
  if (!active) return;
  const y = active.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
  gsap.killTweensOf(navIndicator);
  if (animated && !reduceMotion.matches) gsap.to(navIndicator, { y, duration: 0.42, ease: "power3.inOut", overwrite: "auto" });
  else gsap.set(navIndicator, { y });
}
function openLanguageMenu() {
  const menu = content.querySelector(".language-menu");
  const trigger = content.querySelector(".language-trigger");
  if (!menu || languageMenuOpen) return;
  languageMenuOpen = true;
  menu.classList.toggle("opens-up", trigger.getBoundingClientRect().bottom + 224 > window.innerHeight - 16);
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  if (!reduceMotion.matches) gsap.fromTo(menu, { y: -8, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.22, ease: "power2.out", clearProps: "all" });
  menu.querySelector('[aria-selected="true"]')?.focus();
}
function closeLanguageMenu(onClosed) {
  const menu = content.querySelector(".language-menu");
  const trigger = content.querySelector(".language-trigger");
  if (!menu || !languageMenuOpen) return;
  languageMenuOpen = false;
  trigger.setAttribute("aria-expanded", "false");
  const finish = () => {
    menu.hidden = true;
    gsap.set(menu, { clearProps: "all" });
    if (onClosed) onClosed();
    else trigger.focus();
  };
  gsap.killTweensOf(menu);
  if (reduceMotion.matches) finish();
  else gsap.to(menu, { y: -6, scale: 0.98, autoAlpha: 0, duration: 0.15, ease: "power1.in", onComplete: finish });
}
function openDetailListMenu() {
  const menu = content.querySelector(".detail-list-options");
  const trigger = content.querySelector("[data-list-toggle]");
  if (!menu || !trigger) return;
  gsap.killTweensOf(menu);
  gsap.set(menu, { clearProps: "all" });
  menu.hidden = false;
  menu.classList.toggle("opens-up", trigger.getBoundingClientRect().bottom + menu.offsetHeight + 16 > window.innerHeight);
  trigger.setAttribute("aria-expanded", "true");
  if (!reduceMotion.matches) gsap.fromTo(menu, { y: menu.classList.contains("opens-up") ? 8 : -8, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.22, ease: "power2.out", clearProps: "all" });
  menu.querySelector("button")?.focus();
}
function closeDetailListMenu(restoreFocus = false) {
  const menu = content.querySelector(".detail-list-options");
  const trigger = content.querySelector("[data-list-toggle]");
  if (!menu || !trigger || trigger.getAttribute("aria-expanded") !== "true") return;
  trigger.setAttribute("aria-expanded", "false");
  const finish = () => {
    menu.hidden = true;
    gsap.set(menu, { clearProps: "all" });
    if (restoreFocus) trigger.focus();
  };
  gsap.killTweensOf(menu);
  if (reduceMotion.matches) finish();
  else gsap.to(menu, { y: menu.classList.contains("opens-up") ? 6 : -6, scale: 0.98, autoAlpha: 0, duration: 0.15, ease: "power1.in", onComplete: finish });
}
async function changeLanguage(nextLanguage) {
  if (!translations[nextLanguage]) return;
  if (nextLanguage === language) {
    content.querySelector(".language-trigger")?.focus();
    return;
  }
  const previousLanguage = language;
  language = nextLanguage;
  updateStaticText();
  renderPage();
  content.querySelector(".language-trigger")?.focus();
  try {
    await window.animeBloo.setLanguage(nextLanguage);
  } catch {
    language = previousLanguage;
    updateStaticText();
    renderPage();
    const error = content.querySelector(".settings-error");
    if (error) {
      error.textContent = t("saveError");
      error.hidden = false;
    }
  }
}
async function refreshCacheSize() {
  const size = content.querySelector("[data-cache-size]");
  if (!size) return;
  const generation = ++cacheRefreshGeneration;
  try {
    const { bytes } = await window.animeBloo.getCacheSize();
    if (generation !== cacheRefreshGeneration || !size.isConnected) return;
    const value = `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (size.textContent !== value) {
      size.textContent = value;
      if (!reduceMotion.matches) gsap.fromTo(size, { y: 4, autoAlpha: 0.5 }, { y: 0, autoAlpha: 1, duration: 0.25, ease: "power2.out", clearProps: "all", overwrite: "auto" });
    }
  } catch {
    if (generation === cacheRefreshGeneration && size.isConnected) size.textContent = t("cacheSizeUnavailable");
  }
}
async function clearApplicationCache(button) {
  if (cacheBusy) return;
  cacheBusy = true;
  button.disabled = true;
  button.classList.add("is-clearing");
  const label = button.querySelector(".cache-button-label");
  const status2 = content.querySelector(".cache-status");
  label.textContent = t("clearingCache");
  status2.textContent = "";
  status2.classList.remove("is-error");
  if (!reduceMotion.matches) gsap.to(button, { scale: 0.96, duration: 0.16, ease: "power2.out", overwrite: "auto" });
  try {
    await window.animeBloo.clearCache();
    try { localStorage.removeItem(homeCacheKey()); } catch {}
    if (!button.isConnected) return;
    button.classList.remove("is-clearing");
    button.classList.add("is-complete");
    label.textContent = t("cacheCleared");
    status2.textContent = t("cacheCleared");
    await refreshCacheSize();
    if (!reduceMotion.matches) gsap.to(button, { scale: 1, duration: 0.22, ease: "back.out(2)", overwrite: "auto" });
    await new Promise((resolve) => setTimeout(resolve, 1800));
  } catch {
    if (button.isConnected) {
      status2.textContent = t("cacheClearError");
      status2.classList.add("is-error");
    }
  } finally {
    cacheBusy = false;
    if (button.isConnected) {
      gsap.killTweensOf(button);
      gsap.set(button, { clearProps: "all" });
      button.classList.remove("is-clearing", "is-complete");
      button.disabled = false;
      label.textContent = t("clearCache");
    }
  }
}
navigation.forEach((button) => {
  const icon = button.querySelector(".nav-icon, .settings-icon");
  button.addEventListener("mouseenter", () => animate(icon, { x: 3, scale: 1.08, duration: 0.22, ease: "power2.out" }));
  button.addEventListener("mouseleave", () => animate(icon, { x: 0, scale: 1, duration: 0.22, ease: "power2.out" }));
  button.addEventListener("click", () => showPage(navigationPage(button)));
});
content.addEventListener("click", (event) => {
  const dropdownTrigger = event.target.closest('[data-stream-dropdown-trigger]');
  if (dropdownTrigger) {
    const dropdown = dropdownTrigger.closest('[data-stream-dropdown]');
    const menu = dropdown.querySelector('[data-stream-dropdown-menu]');
    const open = menu.hidden;
    closeStreamDropdowns(dropdown);
    gsap.killTweensOf(menu);
    if (open) {
      menu.hidden = false;
      dropdownTrigger.setAttribute('aria-expanded', 'true');
      gsap.fromTo(menu, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: reduceMotion.matches ? 0 : .22, ease: 'power2.out', force3D: true });
    } else closeStreamDropdowns();
    return;
  }
  const streamOption = event.target.closest('[data-stream-option]');
  if (streamOption) {
    const dropdown = streamOption.closest('[data-stream-dropdown]');
    const select = dropdown.querySelector('select');
    select.value = streamOption.dataset.streamOption;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closeStreamDropdowns();
    dropdown.querySelector('[data-stream-dropdown-trigger]').focus();
    return;
  }
  closeStreamDropdowns();
  if (event.target.closest("[data-close-player]")) { closePlayerAnimated(); return; }
  const upscaleToggleMenu = event.target.closest("[data-upscale-menu-toggle]");
  if (upscaleToggleMenu) {
    const menu = content.querySelector("[data-upscale-menu]");
    menu.hidden = !menu.hidden;
    upscaleToggleMenu.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden && !reduceMotion.matches) gsap.fromTo(menu, { y: -7, scale: 0.98, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.22, ease: "power2.out", clearProps: "all" });
    return;
  }
  const upscaleOption = event.target.closest("[data-upscale-profile]");
  if (upscaleOption) {
    changeUpscaling(void 0, upscaleOption.dataset.upscaleProfile);
    const menu = content.querySelector("[data-upscale-menu]");
    menu.hidden = true;
    content.querySelector("[data-upscale-menu-toggle]").setAttribute("aria-expanded", "false");
    content.querySelector("[data-upscale-menu-toggle]").focus();
    return;
  }
  const video = content.querySelector(".stream-player video");
  if (video && event.target.closest("[data-video-play]")) {
    togglePlayerPlayback(video);
    return;
  }
  if (video && event.target.closest('[data-video-rewind]')) { seekPlayer(video, -10); return; }
  if (video && event.target.closest('[data-video-forward]')) { seekPlayer(video, 10); return; }
  if (video && event.target.closest("[data-video-mute]")) {
    video.muted = !video.muted;
    updateUpscalePlayback();
    return;
  }
  if (video && event.target.closest("[data-video-fullscreen]")) {
    togglePlayerFullscreen();
    return;
  }
  const tab = event.target.closest("[data-bookmark-tab]");
  if (tab) {
    changeBookmarkTab(tab.dataset.bookmarkTab);
    return;
  }
  const removeBookmark = event.target.closest("[data-remove-bookmark]");
  if (removeBookmark) {
    const anime = bookmarks[bookmarkTab].find((item) => item.id === Number(removeBookmark.dataset.removeBookmark));
    toggleLocalBookmark(bookmarkTab, anime, removeBookmark);
    return;
  }
  const openBookmark = event.target.closest("[data-open-bookmark]");
  if (openBookmark) {
    showPage("search", () => openAnime(Number(openBookmark.dataset.openBookmark), true, "bookmarks"));
    return;
  }
  const detailSave = event.target.closest("[data-toggle-detail]");
  if (detailSave) {
    const fromList = Boolean(detailSave.closest(".detail-list-options"));
    const isFavorite = detailSave.dataset.toggleDetail === "favorite";
    toggleLocalBookmark(detailSave.dataset.toggleDetail, selectedAnime, detailSave).finally(() => {
      if (fromList) setTimeout(() => closeDetailListMenu(true), isFavorite && !reduceMotion.matches ? 400 : 0);
    });
    return;
  }
  const listToggle = event.target.closest("[data-list-toggle]");
  if (listToggle) {
    if (listToggle.getAttribute("aria-expanded") === "true") closeDetailListMenu(true);
    else openDetailListMenu();
    return;
  }
  if (event.target.closest("[data-read-more]")) {
    const synopsis = content.querySelector(".detail-synopsis");
    synopsis.textContent = cleanSynopsis(selectedAnime.description);
    synopsis.removeAttribute("title");
    event.target.closest("[data-read-more]").remove();
    return;
  }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = Number(favorite.dataset.favorite);
    const anime = [...homeFeed.upcoming, ...homeFeed.trending, ...homeFeed.releases].find((item) => item.id === id);
    toggleLocalBookmark("favorite", anime, favorite);
    return;
  }
  const homeAnime = event.target.closest("[data-open-anime]");
  if (homeAnime) {
    showPage("search", () => openAnime(Number(homeAnime.dataset.openAnime), homeAnime.dataset.autoplay === "true", "home"));
    return;
  }
  if (event.target.closest("[data-reload-home]")) {
    loadHome();
    return;
  }
  const playButton = event.target.closest("[data-play-episode]");
  if (playButton) {
    playEpisode(Number(playButton.dataset.playEpisode));
    return;
  }
  const expandButton = event.target.closest('[data-stream-panel-expand]');
  if (expandButton) { toggleStreamPanel(expandButton); return; }
  const modeButton = event.target.closest('[data-stream-mode]');
  if (modeButton) {
    changeStreamMode(modeButton.dataset.streamMode);
    return;
  }
  if (event.target.closest('[data-video-next]')) {
    const number = nextEpisodeNumber();
    if (number) playEpisode(number);
    return;
  }
  const qualityToggle = event.target.closest("[data-quality-toggle]");
  if (qualityToggle) {
    const menu = content.querySelector("[data-quality-menu]");
    menu.hidden = !menu.hidden;
    qualityToggle.setAttribute("aria-expanded", String(!menu.hidden));
    return;
  }
  const qualityOption = event.target.closest("[data-quality]");
  if (qualityOption) {
    changeVideoQuality(qualityOption.dataset.quality);
    return;
  }
  const animeButton = event.target.closest("[data-anime-id]");
  if (animeButton) {
    openAnime(Number(animeButton.dataset.animeId));
    return;
  }
  if (event.target.closest("[data-catalog-back]")) {
    const returnPage = animeReturnPage;
    ++catalogRequest;
    selectedId = null;
    selectedAnime = null;
    playingEpisode = null;
    catalogBusy = false;
    catalogError = false;
    streamBusy = false;
    streamError = "";
    animeReturnPage = "search";
    if (returnPage === "search") renderPage();
    else showPage(returnPage);
    return;
  }
  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton && profile) {
    logoutButton.disabled = true;
    if (!reduceMotion.matches) gsap.to(logoutButton, { scale: 0.96, duration: 0.16, ease: "power2.out" });
    window.animeBloo.logoutAniList().then(() => {
      ++homeRequest;
      profile = null;
      homeFeed = { trending: [], releases: [], recommended: [], current: [], favorites: [] };
      homeHistory = [];
      watchSessions = [];
      ++historyRequest;
      bookmarks = { favorite: [], likes: [], planning: [] };
      currentPage = "home";
      navigation.forEach((item) => {
        const active = navigationPage(item) === "home";
        item.classList.toggle("is-active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      positionNavIndicator(false);
      renderPage();
      showAuth();
      authToken.value = "";
      authToken.focus();
    }).catch(() => {
      logoutButton.disabled = false;
      gsap.set(logoutButton, { clearProps: "all" });
      const error = content.querySelector(".settings-error");
      if (error) {
        error.textContent = t("logoutError");
        error.hidden = false;
      }
    });
    return;
  }
  if (event.target.closest('[data-check-updates]')) { updates.check(true); return; }
  const releaseLink = event.target.closest('[data-release-version]');
  if (releaseLink) { updates.open(releaseLink.dataset.releaseVersion); return; }
  if (event.target.closest("[data-preview-update]")) {
    window.animeBloo.previewUpdate().then(displayUpdate).catch(() => {
    });
  }
  const cacheButton = event.target.closest("[data-clear-cache]");
  if (cacheButton) clearApplicationCache(cacheButton);
  const themeOption = event.target.closest("[data-theme-option]");
  if (themeOption) changeTheme(themeOption.dataset.themeOption);
  const action = event.target.closest("[data-go]");
  if (action) showPage(action.dataset.go);
  if (event.target.closest(".language-trigger")) {
    if (languageMenuOpen) closeLanguageMenu();
    else openLanguageMenu();
  }
  const option = event.target.closest("[data-language]");
  if (option) closeLanguageMenu(() => changeLanguage(option.dataset.language));
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(heroTimer);
  else scheduleHeroSlide();
});
function beginWatchSession(video) {
  if (!selectedAnime || !playingEpisode || activeWatchSession?.video === video) return;
  flushWatchSession(false, true);
  const episode = selectedAnime.episodes.find((item) => item.number === playingEpisode.number);
  activeWatchSession = {
    video,
    sessionId: crypto.randomUUID(),
    anilistId: selectedAnime.id,
    episode: playingEpisode.number,
    title: animeTitle(selectedAnime),
    episodeTitle: episode?.title || "",
    image: remoteImage(episode?.aniZipThumbnail) || remoteImage(episode?.kitsuThumbnail) || remoteImage(episode?.scraperThumbnail) || remoteImage(selectedAnime.banner) || remoteImage(selectedAnime.cover) || "",
    watchedSeconds: 0,
    lastTime: video.currentTime,
    lastWrite: Date.now()
  };
}
function flushWatchSession(completed = false, close = false) {
  const session = activeWatchSession;
  if (!session) return;
  if (session.watchedSeconds >= 1) {
    session.lastWrite = Date.now();
    const { sessionId, anilistId, episode, title, episodeTitle, image, watchedSeconds } = session;
    const currentTime = Number.isFinite(session.video.currentTime) ? session.video.currentTime : 0;
    const duration = Number.isFinite(session.video.duration) && session.video.duration > 0 ? session.video.duration : 0;
    window.animeBloo.saveWatchSession({ sessionId, anilistId, episode, title, episodeTitle, image, watchedSeconds, currentTime, duration, completed }).catch(() => {
    });
  }
  if (close) activeWatchSession = null;
}
var lastProgressWrite = 0;
content.addEventListener("playing", (event) => {
  if (event.target.tagName === "VIDEO") beginWatchSession(event.target);
}, true);
content.addEventListener("seeking", (event) => {
  if (event.target === activeWatchSession?.video) activeWatchSession.lastTime = event.target.currentTime;
}, true);
content.addEventListener("timeupdate", (event) => {
  if (event.target.tagName !== "VIDEO" || !playingEpisode || !selectedAnime) return;
  const video = event.target;
  maybePrefetchNextEpisode(video);
  if (!video.paused) {
    beginWatchSession(video);
    const session = activeWatchSession;
    const delta = video.currentTime - session.lastTime;
    if (delta > 0 && delta < 2.5) session.watchedSeconds += delta;
    session.lastTime = video.currentTime;
    if (Date.now() - session.lastWrite >= 1e4) flushWatchSession();
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0 || Date.now() - lastProgressWrite < 3e3) return;
  saveCurrentProgress(video);
}, true);
content.addEventListener("pause", (event) => {
  if (event.target === activeWatchSession?.video && !event.target.ended) flushWatchSession();
  if (event.target.tagName === 'VIDEO' && !event.target.ended) saveCurrentProgress(event.target);
}, true);
content.addEventListener("ended", (event) => {
  if (event.target.tagName !== "VIDEO" || !playingEpisode || !selectedAnime) return;
  flushWatchSession(true, true);
  saveCurrentProgress(event.target, true);
  const next = nextEpisodeNumber();
  if (next) playEpisode(next);
}, true);
content.addEventListener("input", (event) => {
  if (event.target.matches("[data-video-seek]")) {
    const video = content.querySelector(".stream-player video");
    if (video && Number.isFinite(video.duration)) video.currentTime = Number(event.target.value) / 1e3 * video.duration;
    return;
  }
  if (event.target.id !== "catalog-search") return;
  clearTimeout(searchTimer);
  ++catalogRequest;
  searchTerm = event.target.value;
  if (searchTerm.trim().length < 2) {
    searchResults = [];
    catalogBusy = false;
    catalogError = false;
    updateSearchResults();
    return;
  }
  const status2 = content.querySelector(".catalog-message");
  if (status2) status2.textContent = t("searchingAnime");
  searchTimer = setTimeout(() => runSearch(searchTerm), 320);
});
content.addEventListener("change", (event) => {
  if (event.target.matches('[data-audio-lang]')) changeTrackPreference('audio', event.target.value);
  if (event.target.matches('[data-subtitle-lang]')) changeTrackPreference('subtitle', event.target.value);
  if (event.target.matches("[data-player-upscale]")) changeUpscaling(undefined, event.target.value);
  if (event.target.matches("[data-auto-skip]")) saveAutoSkip(event.target.checked);
  if (event.target.matches("[data-upscale-toggle]")) changeUpscaling(event.target.checked);
});
content.addEventListener("error", (event) => {
  const image = event.target;
  if (image.tagName !== "IMG" || !image.dataset.artFallbacks) return;
  const remaining = JSON.parse(image.dataset.artFallbacks);
  const next = remaining.shift();
  if (next) {
    image.dataset.artFallbacks = JSON.stringify(remaining);
    image.src = next;
  }
}, true);
content.addEventListener("pointerover", (event) => {
  const button = event.target.closest(".theme-option:not(.is-selected)");
  if (button && !button.contains(event.relatedTarget)) animate(button.querySelector(".theme-icon"), { y: -2, scale: 1.12, duration: 0.22, ease: "power2.out" });
});
content.addEventListener("pointerout", (event) => {
  const button = event.target.closest(".theme-option");
  if (button && !button.contains(event.relatedTarget)) animate(button.querySelector(".theme-icon"), { y: 0, scale: 1, duration: 0.22, ease: "power2.out" });
});
window.addEventListener("resize", () => {
  positionThemeIndicator(false);
  positionNavIndicator(false);
});
window.animeBloo.onSystemThemeChange((resolved) => {
  if (theme === "system") applyTheme(resolved);
});
document.addEventListener("pointerdown", (event) => {
  if (languageMenuOpen && !event.target.closest(".language-picker")) closeLanguageMenu();
  if (!event.target.closest(".detail-list-menu")) closeDetailListMenu();
  if (!event.target.closest(".upscale-picker")) {
    const menu = content.querySelector("[data-upscale-menu]");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      content.querySelector("[data-upscale-menu-toggle]").setAttribute("aria-expanded", "false");
    }
  }
});
function isEditingText(event) {
  return [event.target, document.activeElement].some((element) =>
    element instanceof Element && (element.matches('input, textarea, select') || element.isContentEditable));
}
window.addEventListener('keydown', (event) => {
  if (!playerOpen || event.altKey || event.ctrlKey || event.metaKey || isEditingText(event)) return;
  const key = event.code === 'Space' ? 'Space' : event.key;
  if (!['Space', 'Escape', 'ArrowLeft', 'ArrowRight', 'f', 'F', 'm', 'M'].includes(key)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (key === 'Escape') { closePlayerAnimated(); return; }
  if (playerClosing || key === 'Space' && event.repeat) return;
  const video = content.querySelector('.stream-player video');
  if (!video) return;
  if (key === 'Space') togglePlayerPlayback(video);
  else if (key === 'ArrowLeft') seekPlayer(video, -10);
  else if (key === 'ArrowRight') seekPlayer(video, 10);
  else if (key.toLowerCase() === 'm') { video.muted = !video.muted; updateUpscalePlayback(); showPlayerHud(); }
  else if (key.toLowerCase() === 'f') togglePlayerFullscreen();
}, true);
let playerPointerFrame = 0;
window.addEventListener('pointermove', () => {
  if (!playerOpen || playerPointerFrame) return;
  playerPointerFrame = requestAnimationFrame(() => { playerPointerFrame = 0; showPlayerHud(); });
}, { passive: true });
content.addEventListener('pointerover', (event) => {
  const back = event.target.closest('.player-back');
  if (back && !back.contains(event.relatedTarget)) gsap.to(back.querySelector('svg'), { x: -3, duration: .25, ease: 'power3.out', force3D: true, overwrite: 'auto' });
});
content.addEventListener('pointerout', (event) => {
  const back = event.target.closest('.player-back');
  if (back && !back.contains(event.relatedTarget)) gsap.to(back.querySelector('svg'), { x: 0, duration: .25, ease: 'power3.out', force3D: true, overwrite: 'auto' });
});
document.addEventListener('fullscreenchange', updateUpscalePlayback);
document.addEventListener("keydown", (event) => {
  if (isEditingText(event)) return;
  const detailMenu = content.querySelector(".detail-list-options");
  if (detailMenu && !detailMenu.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDetailListMenu(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = [...detailMenu.querySelectorAll("button")];
      const index = options.indexOf(document.activeElement);
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
      return;
    }
  }
  const upscaleMenu = content.querySelector("[data-upscale-menu]");
  if (upscaleMenu && !upscaleMenu.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      upscaleMenu.hidden = true;
      content.querySelector("[data-upscale-menu-toggle]").setAttribute("aria-expanded", "false");
      content.querySelector("[data-upscale-menu-toggle]").focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = [...upscaleMenu.querySelectorAll("[data-upscale-profile]")];
      const index = options.indexOf(document.activeElement);
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
      return;
    }
  }
  if (!languageMenuOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLanguageMenu();
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const options = [...content.querySelectorAll(".language-option")];
    const index = options.indexOf(document.activeElement);
    options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
  }
});
document.querySelectorAll("[data-window-action]").forEach((button) => {
  button.addEventListener("mouseenter", () => animate(button.querySelector("svg"), { scale: 1.14, duration: 0.18, ease: "power2.out" }));
  button.addEventListener("mouseleave", () => animate(button.querySelector("svg"), { scale: 1, duration: 0.18, ease: "power2.out" }));
  button.addEventListener("click", () => window.animeBloo.windowAction(button.dataset.windowAction));
});
updateButton.addEventListener("mouseenter", () => animate(updateButton, { scale: 1.045, y: -2, duration: 0.2, ease: "power2.out" }));
updateButton.addEventListener("mouseleave", () => animate(updateButton, { scale: 1, y: 0, duration: 0.2, ease: "power2.out" }));
updateButton.addEventListener("click", () => {
  if (!availableUpdate) return;
  if (!reduceMotion.matches) gsap.fromTo(updateButton, { scale: 0.94 }, { scale: 1.045, duration: 0.28, ease: "back.out(2)", overwrite: "auto" });
  showPage("update");
});
window.animeBloo.onMaximizedChange((maximized) => {
  isMaximized = maximized;
  maximizeButtons.forEach((button) => button.setAttribute("aria-label", authScreen.contains(button) ? authT(maximized ? "restore" : "maximize") : t(maximized ? "restore" : "maximize")));
});
document.querySelector("#auth-open").addEventListener("click", async () => {
  authMessage = "";
  authStatus.textContent = "";
  try {
    await window.animeBloo.openAniListAuth();
  } catch {
    showAuth("authOpenError");
  }
});
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (authBusy || !authToken.value.trim()) return;
  authBusy = true;
  authConnect.disabled = true;
  authConnect.textContent = authT("authConnecting");
  authStatus.textContent = "";
  if (!reduceMotion.matches) gsap.to(authConnect, { scale: 0.97, duration: 0.16, ease: "power2.out" });
  try {
    const result = await window.animeBloo.connectAniList(authToken.value);
    if (result.status === "ok") {
      profile = result.profile;
      authToken.value = "";
      renderPage();
      loadHome();
      showApp();
    } else showAuth(result.status === "network" ? "authNetwork" : "authInvalid");
  } catch {
    showAuth("authNetwork");
  } finally {
    authBusy = false;
    authConnect.disabled = false;
    authConnect.textContent = authT("authConnect");
    gsap.set(authConnect, { clearProps: "all" });
  }
});
updateStaticText();
renderPage();
requestAnimationFrame(() => positionNavIndicator(false));
showAvailableUpdate();
window.animeBloo.restoreAuth().then((result) => {
  authReady = true;
  if (result.status === "ok") {
    profile = result.profile;
    loadHome();
    showApp();
  } else showAuth(result.status === "network" ? "authNetwork" : result.status === "invalid" ? "authInvalid" : "");
}).catch(() => {
  authReady = true;
  showAuth("authNetwork");
});

