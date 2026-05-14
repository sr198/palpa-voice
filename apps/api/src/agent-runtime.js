import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexProvider, InMemoryRuntimeStore, SessionManager } from '../../../packages/agent-runtime/src/index.js';
import { buildCodexSandboxPolicy } from './codex-settings.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let sharedRuntime;

export function getAgentRuntime(config = {}) {
  if (!sharedRuntime) {
    const provider = new CodexProvider({
      config: {
        codexBinary: config.codexBinary || 'codex',
        codexCwd: config.codexCwd || repoRoot,
        codexModel: config.codexModel || null,
        codexApprovalPolicy: config.codexApprovalPolicy || null,
        codexSandboxPolicy: buildCodexSandboxPolicy(config),
        clientName: 'palpa-api',
        clientTitle: 'Palpa API',
        clientVersion: '0.1.0',
        experimentalApi: true
      }
    });

    sharedRuntime = new SessionManager({
      provider,
      store: new InMemoryRuntimeStore()
    });
  }

  return sharedRuntime;
}

export async function initializeAgentRuntime(config = {}) {
  const runtime = getAgentRuntime(config);
  await runtime.initialize();
  return runtime;
}

export function getCodexProvider(config = {}) {
  return getAgentRuntime(config).provider;
}
