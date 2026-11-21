'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { USER_AGENT } = require('./mediaProxy.cjs');

let binary;
try { binary = path.join(path.dirname(require.resolve('@ffprobe-installer/win32-x64/package.json')), 'ffprobe.exe'); } catch { binary = null; }

function probeMediaTracks(source) {
  if (!binary) return Promise.resolve({});
  return new Promise(resolve => {
    const referer = source.referer || new URL(source.url).origin + '/';
    const headers = `Referer: ${referer}\r\nOrigin: ${new URL(referer).origin}\r\n`;
    execFile(binary, ['-v', 'error', '-user_agent', USER_AGENT, '-headers', headers,
      '-probesize', '262144', '-analyzeduration', '1000000', '-show_streams', '-of', 'json', source.url],
    { timeout: 2500, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { resolve({}); return; }
      try {
        const streams = JSON.parse(stdout).streams || [];
        const languages = type => [...new Set(streams.filter(stream => stream.codec_type === type)
          .map(stream => String(stream.tags?.language || '').toLowerCase())
          .filter(language => /^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language) && !['und', 'mul', 'zxx'].includes(language)))];
        resolve({ audioLanguages: languages('audio'), subtitleLanguages: languages('subtitle') });
      } catch { resolve({}); }
    });
  });
}

module.exports = { probeMediaTracks };
