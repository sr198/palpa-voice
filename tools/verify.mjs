import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'test', '--workspace', 'packages/agent-runtime']],
  ['npm', ['run', 'test', '--workspace', 'apps/api']],
  ['python3', ['-m', 'unittest', 'discover', '-s', 'services/voice/tests']]
];

let failed = false;

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
