'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HISTORY_LIMIT = 20;
const SESSION_LIMIT = 32;

function compact(sessions) {
  const byAnime = new Map();
  for (const entry of sessions) {
    if (!entry || !Number.isSafeInteger(entry.anilistId) || entry.anilistId < 1) continue;
    const prior = byAnime.get(entry.anilistId);
    const recent = !prior || (Date.parse(entry.updatedAt) || 0) > (Date.parse(prior.updatedAt) || 0);
    const sessionSeconds = { ...(prior?.sessionSeconds || {}) };
    if (entry.sessionSeconds && typeof entry.sessionSeconds === 'object' && !Array.isArray(entry.sessionSeconds)) {
      for (const [id, seconds] of Object.entries(entry.sessionSeconds)) {
        if (Number.isFinite(seconds) && seconds >= 0) sessionSeconds[id] = Math.max(sessionSeconds[id] || 0, seconds);
      }
    } else if (typeof entry.sessionId === 'string' && Number.isFinite(entry.watchedSeconds)) {
      sessionSeconds[entry.sessionId] = Math.max(sessionSeconds[entry.sessionId] || 0, entry.watchedSeconds);
    }
    const latest = recent ? entry : prior;
    const total = Object.values(sessionSeconds).reduce((sum, seconds) => sum + seconds, 0);
    const merged = { ...latest, watchedSeconds: Math.max(total, prior?.sessionSeconds ? prior.watchedSeconds : 0, entry.sessionSeconds ? entry.watchedSeconds : 0), sessionSeconds };
    if (!Number.isFinite(merged.currentTime)) merged.currentTime = 0;
    if (!Number.isFinite(merged.duration)) merged.duration = 0;
    merged.status = merged.completed ? 'completed' : 'in_progress';
    byAnime.set(entry.anilistId, merged);
  }
  return [...byAnime.values()].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, HISTORY_LIMIT).map((entry) => ({ ...entry, sessionSeconds: Object.fromEntries(Object.entries(entry.sessionSeconds).slice(-SESSION_LIMIT)) }));
}

function createWatchHistory(directory) {
  const file = path.join(directory, 'watch-history.json');
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  function write(data) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function all(userId) {
    const data = read();
    const key = String(userId);
    const existing = Array.isArray(data[key]) ? data[key] : [];
    const sessions = compact(existing);
    if (JSON.stringify(existing) !== JSON.stringify(sessions)) { data[key] = sessions; write(data); }
    return sessions;
  }
  function save(userId, input) {
    const { sessionId, anilistId, episode, watchedSeconds, title, episodeTitle, image, completed, currentTime = 0, duration = 0 } = input || {};
    if (!Number.isSafeInteger(userId) || userId < 1 || typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(sessionId) ||
        !Number.isSafeInteger(anilistId) || anilistId < 1 || !Number.isSafeInteger(episode) || episode < 1 ||
        !Number.isFinite(watchedSeconds) || watchedSeconds < 0 || watchedSeconds > 86400 ||
        !Number.isFinite(currentTime) || currentTime < 0 || !Number.isFinite(duration) || duration < 0) throw new RangeError('Invalid watch session');
    const data = read();
    const key = String(userId);
    const sessions = compact(Array.isArray(data[key]) ? data[key] : []);
    const previous = sessions.find((entry) => entry.anilistId === anilistId);
    const sessionSeconds = { ...(previous?.sessionSeconds || {}) };
    const lateUpdate = previous && previous.sessionId !== sessionId && Object.hasOwn(sessionSeconds, sessionId);
    const priorSeconds = sessionSeconds[sessionId] || 0;
    sessionSeconds[sessionId] = Math.max(priorSeconds, Math.floor(watchedSeconds));
    const record = {
      sessionId, anilistId, episode,
      watchedSeconds: (previous?.watchedSeconds || 0) + sessionSeconds[sessionId] - priorSeconds,
      sessionSeconds: Object.fromEntries(Object.entries(sessionSeconds).slice(-SESSION_LIMIT)),
      title: String(title || '').slice(0, 250), episodeTitle: String(episodeTitle || '').slice(0, 250),
      image: typeof image === 'string' && /^https:\/\//i.test(image) ? image.slice(0, 2000) : '',
      currentTime, duration,
      completed: Boolean(completed) || Boolean(previous?.episode === episode && previous?.completed),
      status: completed || previous?.episode === episode && previous?.completed ? 'completed' : 'in_progress',
      updatedAt: new Date().toISOString(),
    };
    if (lateUpdate) Object.assign(record, {
      sessionId: previous.sessionId, episode: previous.episode, title: previous.title,
      episodeTitle: previous.episodeTitle, image: previous.image,
      currentTime: previous.currentTime, duration: previous.duration,
      completed: previous.completed, status: previous.status, updatedAt: previous.updatedAt,
    });
    data[key] = compact([record, ...sessions.filter((entry) => entry.anilistId !== anilistId)]);
    write(data);
    return record;
  }
  return { all, save };
}

module.exports = { createWatchHistory };
