const { version: currentVersion } = require('../package.json');

const RELEASES_API = 'https://api.github.com/repos/cayo/AnimeBloo/releases/latest';
const RELEASE_URL = /^https:\/\/github\.com\/cayo\/AnimeBloo\/releases\/tag\/[^/?#]+$/;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const aNumeric = /^\d+$/.test(a.prerelease[i]);
    const bNumeric = /^\d+$/.test(b.prerelease[i]);
    if (aNumeric && bNumeric) {
      const difference = Number(a.prerelease[i]) - Number(b.prerelease[i]);
      if (difference) return Math.sign(difference);
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else {
      const difference = a.prerelease[i].localeCompare(b.prerelease[i], 'en');
      if (difference) return Math.sign(difference);
    }
  }
  return 0;
}

async function getLatestRelease(fetchRelease = fetch) {
  try {
    const response = await fetchRelease(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AnimeBloo-Update-Checker' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const release = await response.json();
    if (release?.draft || release?.prerelease) return null;
    const tag = release?.tag_name;
    const url = release?.html_url;
    if (typeof tag !== 'string' || typeof url !== 'string' || !RELEASE_URL.test(url)) return null;
    if (compareVersions(tag, currentVersion) === null) return null;
    return { version: tag.replace(/^v/, ''), url };
  } catch {
    // A release check must never prevent the launcher from starting offline.
    return null;
  }
}

async function checkForUpdate(fetchRelease = fetch) {
  const release = await getLatestRelease(fetchRelease);
  return release && compareVersions(release.version, currentVersion) === 1 ? release : null;
}

module.exports = { checkForUpdate, getLatestRelease, compareVersions };

function releaseSummary(body) {
  return String(body || '').slice(0, 20000)
    .replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/<[^>]*>/g, '')
    .split(/\r?\n/).filter(line => !/^\s*#/.test(line) && !/full changelog|contributors|figma|ready for.*design/i.test(line))
    .join(' ').replace(/[*_`~>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
}
function normalizeRelease(release) {
  if (!release || release.draft || release.prerelease || !parseVersion(release.tag_name || '') ||
      parseVersion(release.tag_name).prerelease.length || !RELEASE_URL.test(release.html_url || '')) return null;
  return { version: release.tag_name.replace(/^v/, ''), url: release.html_url,
    date: Number.isFinite(Date.parse(release.published_at)) ? new Date(release.published_at).toISOString() : null,
    summary: releaseSummary(release.body) };
}
async function getReleaseHistory(fetchRelease = fetch) {
  try {
    const response = await fetchRelease(RELEASES_API.replace('/latest', '?per_page=30'), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AnimeBloo-Update-Checker' }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;
    return [...new Map(data.map(normalizeRelease).filter(Boolean).map(item => [item.version, item])).values()]
      .sort((a, b) => compareVersions(b.version, a.version));
  } catch { return null; }
}
module.exports.getReleaseHistory = getReleaseHistory;
module.exports.releaseSummary = releaseSummary;
