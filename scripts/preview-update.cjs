const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, ANIMEBLOO_PREVIEW_UPDATE: '1' },
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
