import { gsap } from 'gsap';
const preferenceKey = 'animebloo.autoSkip';
export function readAutoSkip() { try { return localStorage.getItem(preferenceKey) === 'true'; } catch { return false; } }
export function saveAutoSkip(enabled) { try { localStorage.setItem(preferenceKey, String(Boolean(enabled))); } catch { /* Session-only storage may be unavailable. */ } }

export function mountAniSkip(video, { anime, episode, translate, reducedMotion }) {
  const button = video?.closest('.video-stage')?.querySelector('[data-aniskip]');
  if (!button || !anime || !episode) return () => {};
  let disposed = false, revision = 0, intervals = [], active = null, shown = false, requestedLength = null, autoAttempt = null;
  const listeners = [];
  const on = (target, name, callback) => { target.addEventListener(name, callback); listeners.push(() => target.removeEventListener(name, callback)); };
  function show(interval) {
    active = interval;
    button.disabled = !interval;
    if (interval) button.querySelector('[data-aniskip-label]').textContent = translate(interval.type === 'op' ? 'skipIntro' : 'skipOutro');
    if (shown === Boolean(interval)) return;
    shown = Boolean(interval);
    gsap.killTweensOf(button);
    if (shown) {
      button.hidden = false;
      if (reducedMotion.matches) gsap.set(button, { autoAlpha: 1, y: 0 });
      else gsap.fromTo(button, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .26, ease: 'power2.out' });
    } else {
      if (document.activeElement === button) video.closest('.video-stage').querySelector('[data-video-play]')?.focus({ preventScroll: true });
      if (reducedMotion.matches) button.hidden = true;
      else gsap.to(button, { autoAlpha: 0, y: 5, duration: .18, ease: 'power2.in', onComplete: () => { button.hidden = true; } });
    }
  }
  function skip() {
    const interval = intervals.find(item => video.currentTime >= item.startTime && video.currentTime < item.endTime);
    if (!interval || !Number.isFinite(video.duration)) return;
    try { video.currentTime = Math.min(interval.endTime, video.duration); show(null); } catch { /* A source may no longer be seekable. */ }
  }
  function update() {
    if (disposed || !video.isConnected) return;
    const interval = intervals.find(item => video.currentTime >= item.startTime && video.currentTime < item.endTime) || null;
    if (interval !== autoAttempt) autoAttempt = null;
    show(interval);
    if (interval && readAutoSkip() && !video.paused && !video.seeking && autoAttempt !== interval) { autoAttempt = interval; skip(); }
  }
  async function load() {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const length = Math.round(video.duration);
    if (length === requestedLength) return;
    requestedLength = length;
    const request = ++revision;
    intervals = []; show(null);
    try {
      const result = await window.animeBloo.getSkipTimes?.({ anilistId: anime.id, malId: anime.malId, episode, episodeLength: video.duration });
      if (disposed || request !== revision) return;
      intervals = Array.isArray(result) ? result : [];
      update();
    } catch { /* Missing timestamps and offline episodes stay silent. */ }
  }
  on(video, 'loadedmetadata', load); on(video, 'durationchange', load);
  on(video, 'emptied', () => { ++revision; requestedLength = null; intervals = []; autoAttempt = null; show(null); });
  for (const name of ['timeupdate', 'seeked', 'seeking', 'play', 'playing']) on(video, name, update);
  on(button, 'click', skip);
  on(document, 'keydown', event => {
    if (!active || disposed || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    if (event.key.toLowerCase() !== 's' && event.key !== 'Tab') return;
    event.preventDefault(); skip();
  });
  return () => { disposed = true; ++revision; listeners.forEach(remove => remove()); gsap.killTweensOf(button); button.hidden = true; button.disabled = true; };
}
