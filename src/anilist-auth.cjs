const fs = require('node:fs');
const path = require('node:path');

const ANILIST_CLIENT_ID = '57329';
const ANILIST_AUTHORIZE_URL = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;
const VIEWER_QUERY = 'query { Viewer { id name avatar { large } } }';

function createAuthStore(directory) {
  const file = path.join(directory, 'anilist-session.json');

  function get() {
    try {
      const session = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof session.token !== 'string' || !session.token || !Number.isSafeInteger(session.id) ||
          typeof session.name !== 'string' || typeof session.avatar !== 'string') return null;
      return session;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function set(value) {
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryFile, file);
    } catch (error) {
      try { fs.unlinkSync(temporaryFile); } catch { /* Nothing to clean up. */ }
      throw error;
    }
  }

  function clear() {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  return { get, set, clear };
}

async function verifyToken(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token)) return { status: 'invalid' };
  const cleanToken = token.trim();
  let response;
  try {
    response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanToken}` },
      body: JSON.stringify({ query: VIEWER_QUERY }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { status: 'network' };
  }
  if (response.status === 401 || response.status === 403) return { status: 'invalid' };
  if (!response.ok) return { status: 'network' };
  let data;
  try { data = await response.json(); } catch { return { status: 'network' }; }
  const viewer = data?.data?.Viewer;
  if (!Number.isSafeInteger(viewer?.id) || typeof viewer?.name !== 'string' || !viewer.name ||
      typeof viewer?.avatar?.large !== 'string') return { status: 'invalid' };
  return { status: 'ok', session: { token: cleanToken, id: viewer.id, name: viewer.name, avatar: viewer.avatar.large } };
}

function publicProfile(session) {
  return { id: session.id, name: session.name, avatar: session.avatar };
}

module.exports = { ANILIST_CLIENT_ID, ANILIST_AUTHORIZE_URL, VIEWER_QUERY, createAuthStore, verifyToken, publicProfile };
