import { spawnSync } from 'node:child_process';

function readStatusField(name) {
  const result = spawnSync('bash', ['-lc', `grep '^${name}:' /proc/self/status | awk '{print $2}'`], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || '').trim() || null;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

export function getCodexDiagnostics(config) {
  const whichCodex = runCommand('bash', ['-lc', `command -v ${config.codexBinary || 'codex'}`]);
  const whichBwrap = runCommand('bash', ['-lc', 'command -v bwrap']);
  const idInfo = runCommand('id', []);

  const bwrapCheck = runCommand('bwrap', [
    '--unshare-user',
    '--uid', '0',
    '--gid', '0',
    '--ro-bind', '/', '/',
    '--proc', '/proc',
    '--dev', '/dev',
    '--bind', config.codexCwd, config.codexCwd,
    '--chdir', config.codexCwd,
    '/bin/sh',
    '-lc',
    'pwd >/dev/null && test -r package.json'
  ]);

  return {
    cwd: config.codexCwd,
    sandbox_mode: config.codexSandboxMode,
    writable_roots: config.codexWritableRoots?.length ? config.codexWritableRoots : [config.codexCwd],
    approval_policy: config.codexApprovalPolicy,
    network_access: config.codexNetworkAccess !== false,
    binary: config.codexBinary || 'codex',
    binary_path: whichCodex.ok ? whichCodex.stdout : null,
    bwrap_path: whichBwrap.ok ? whichBwrap.stdout : null,
    process: {
      uid_gid: idInfo.ok ? idInfo.stdout : null,
      no_new_privs: readStatusField('NoNewPrivs'),
      seccomp: readStatusField('Seccomp')
    },
    bwrap_self_check: {
      ok: bwrapCheck.ok,
      status: bwrapCheck.status,
      stderr: bwrapCheck.stderr || null
    }
  };
}
