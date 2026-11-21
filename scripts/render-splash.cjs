const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const hyperframes = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
const ffmpeg = path.join(root, 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
const ffprobe = path.join(root, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe');
for (const [source, filename] of [[root, 'splash.mp4'], [path.join(root, 'splash-light'), 'splash-light.mp4']]) {
  const output = path.join(root, 'src', 'renderer', 'assets', filename);
  const result = spawnSync(process.execPath, [hyperframes, 'render', source, '--output', output, '--fps', '60', '--quality', 'high', '--workers', '2'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, HYPERFRAMES_FFMPEG_PATH: ffmpeg, HYPERFRAMES_FFPROBE_PATH: ffprobe },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
