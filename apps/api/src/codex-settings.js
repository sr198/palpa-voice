import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseWritableRoots(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildCodexSandboxPolicy(config) {
  const mode = config.codexSandboxMode || 'workspace-write';

  if (mode === 'danger-full-access' || mode === 'read-only') {
    return mode;
  }

  const writableRoots = config.codexWritableRoots?.length
    ? config.codexWritableRoots
    : [config.codexCwd || repoRoot];

  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: config.codexNetworkAccess !== false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}
