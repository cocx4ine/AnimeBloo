const fs = require('node:fs');
const path = require('node:path');
const { baseAnime } = require('./multiApi.cjs');

const PLANNING_QUERY = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME, status: PLANNING) {
    lists { entries { media { id title { romaji english native } startDate { year } seasonYear coverImage { extraLarge large medium } bannerImage averageScore isAdult } } }
  }
  scored: MediaListCollection(userId: $userId, type: ANIME) {
    lists { entries { score(format: POINT_100) media { id title { romaji english native } startDate { year } seasonYear coverImage { extraLarge large medium } bannerImage averageScore isAdult } } }
  }
}`;

function createBookmarks(directory, fetchImpl = fetch) {
  const file = path.join(directory, 'bookmarks.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  function write(data) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* No temporary file. */ }
      throw error;
    }
  }
  function account(session) {
    if (!Number.isSafeInteger(session?.id) || session.id <= 0) throw new Error('Invalid account');
    const data = read();
    const key = String(session.id);
    const saved = data[key] || { favorite: [], likes: [], planning: [], syncedAt: null };
    return { data, key, saved };
  }
  function all(session) {
    const { saved } = account(session);
    const hidden = new Set(saved.hiddenLikes || []);
    const likes = [...new Map([...(saved.scoredLikes || []).filter((item) => !hidden.has(item.id)), ...(saved.likes || [])].map((item) => [item.id, item])).values()];
    return { favorite: saved.favorite || [], likes, planning: saved.planning || [], syncedAt: saved.syncedAt || null };
  }
  function toggle(session, category, anime) {
    if (!['favorite', 'likes'].includes(category) || !Number.isSafeInteger(anime?.id) || anime.id <= 0) throw new RangeError('Invalid bookmark');
    const { data, key, saved } = account(session);
    const items = saved[category] || [];
    const existing = items.findIndex((item) => item.id === anime.id);
    const selected = category === 'likes' ? all(session).likes.some((item) => item.id === anime.id) : existing >= 0;
    if (existing >= 0) items.splice(existing, 1);
    if (category === 'likes' && selected) saved.hiddenLikes = [...new Set([...(saved.hiddenLikes || []), anime.id])];
    else if (category === 'likes') saved.hiddenLikes = (saved.hiddenLikes || []).filter((id) => id !== anime.id);
    if (!selected) items.unshift({ id: anime.id, title: anime.title, cover: anime.cover, score: anime.score, year: anime.year });
    saved[category] = items;
    data[key] = saved;
    write(data);
    return { selected: !selected, bookmarks: all(session) };
  }
  async function syncPlanning(session) {
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ query: PLANNING_QUERY, variables: { userId: session.id } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`AniList planning request failed: ${response.status}`);
    const result = await response.json();
    if (result.errors?.length || !result.data || !Object.hasOwn(result.data, 'MediaListCollection')) throw new Error('Invalid AniList planning response');
    const normalize = (entries) => [...new Map(entries.map((entry) => entry.media).filter((media) => media && !media.isAdult)
      .map((media) => { const anime = baseAnime(media); return [anime.id, { id: anime.id, title: anime.title, cover: anime.cover, score: anime.score, year: anime.year }]; })).values()];
    const planning = normalize((result.data.MediaListCollection?.lists || []).flatMap((list) => list.entries || []));
    const scoredLikes = normalize((result.data.scored?.lists || []).flatMap((list) => list.entries || []).filter((entry) => entry.score >= 80));
    const { data, key, saved } = account(session);
    saved.planning = planning;
    saved.scoredLikes = scoredLikes;
    saved.syncedAt = new Date().toISOString();
    data[key] = saved;
    write(data);
    return all(session);
  }
  return { all, toggle, syncPlanning };
}

module.exports = { createBookmarks, PLANNING_QUERY };
