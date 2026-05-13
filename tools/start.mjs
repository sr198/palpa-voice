import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);

const processes = [
  ['npm', ['run', 'start', '--workspace', 'apps/web']],
  ['npm', ['run', 'start', '--workspace', 'apps/api']],
  ['python3', ['services/voice/main.py']]
];

const children = processes.map(([command, args]) =>
  spawn(command, args, {
    cwd: root,
    stdio: 'inherit'
  })
);

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
