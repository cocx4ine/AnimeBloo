'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createWatchProgress(directory, fetchImpl = fetch) {
  const file = path.join(directory, 'watch-progress.json');
  function all() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
  }
  function save(anilistId, episode, seconds, duration) {
    if (![anilistId, episode].every((value) => Number.isSafeInteger(value) && value > 0) ||
        !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration < 0) throw new RangeError('Invalid watch progress');
    const records = all();
    const key = `${anilistId}:${episode}`;
    const status = duration > 0 && seconds / duration >= .9 ? 'completed' : 'in_progress';
    records[key] = { anilistId, episode, episodeNumber: episode, seconds, currentTime: seconds, duration, status, updatedAt: new Date().toISOString() };
    // The latest pointer belongs to the anime, while episode entries drive each card's progress bar.
    records[`latest:${anilistId}`] = records[key];
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
    return records[key];
  }
  async function sync(session, record) {
    if (!session?.token || !record || record.duration < 1 || record.seconds / record.duration < .9) return false;
    const current = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ query: 'query ($mediaId: Int, $userId: Int) { MediaList(mediaId: $mediaId, userId: $userId) { progress } }', variables: { mediaId: record.anilistId, userId: session.id } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!current.ok) throw new Error('AniList progress lookup failed');
    const currentData = await current.json();
    if (currentData.errors?.length && !/not found/i.test(currentData.errors[0].message || '')) throw new Error('AniList progress lookup failed');
    if ((currentData.data?.MediaList?.progress || 0) >= record.episode) return true;
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ query: 'mutation ($mediaId: Int, $progress: Int) { SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id progress } }', variables: { mediaId: record.anilistId, progress: record.episode } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || (await response.json()).errors?.length) throw new Error('AniList progress sync failed');
    return true;
  }
  return { all, save, sync };
}
module.exports = { createWatchProgress };
