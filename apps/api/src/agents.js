import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { CodexAppServerClient } from './codex-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const roleSkillNameByAgentId = {
  architect: 'architect-voice',
  orchestrator: 'orchestrator-voice',
  'voice-lead': 'voice-lead',
  frontend: 'frontend-voice'
};
const repoSkillRegistry = [
  {
    name: 'voice-mode',
    description: 'Shared voice-mode reply constraints for Palpa.',
    path: path.join(repoRoot, '.agents/skills/voice-mode/SKILL.md')
  },
  {
    name: 'architect-voice',
    description: 'Project-local architect role guidance for Palpa.',
    path: path.join(repoRoot, '.agents/skills/architect-voice/SKILL.md')
  },
  {
    name: 'orchestrator-voice',
    description: 'Project-local orchestration role guidance for Palpa.',
    path: path.join(repoRoot, '.agents/skills/orchestrator-voice/SKILL.md')
  },
  {
    name: 'voice-lead',
    description: 'Project-local voice pipeline role guidance for Palpa.',
    path: path.join(repoRoot, '.agents/skills/voice-lead/SKILL.md')
  },
  {
    name: 'frontend-voice',
    description: 'Project-local frontend role guidance for Palpa.',
    path: path.join(repoRoot, '.agents/skills/frontend-voice/SKILL.md')
  }
];

const replyOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['spoken_text', 'artifact_text', 'topics'],
  properties: {
    spoken_text: { type: 'string' },
    artifact_text: { type: 'string' },
    topics: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

let sharedClient;

export const gatewayAgent = {
  id: 'gateway',
  name: 'Gateway',
  role: 'Supervisor',
  voiceId: 'af_bella',
  summary: 'Routes a spoken turn to the selected Codex specialist and keeps speech concise.'
};

export const agentRegistry = [
  {
    id: 'architect',
    name: 'Architect',
    role: 'System design',
    voiceId: 'af_bella',
    summary: 'Focuses on architecture, service boundaries, and long-term system shape.'
  },
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'Runtime flow',
    voiceId: 'af_nova',
    summary: 'Focuses on session state, event contracts, transport, and runtime sequencing.'
  },
  {
    id: 'voice-lead',
    name: 'Voice Lead',
    role: 'ASR and TTS pipeline',
    voiceId: 'af_heart',
    summary: 'Focuses on Whisper, Kokoro, voice UX, and spoken interaction constraints.'
  },
  {
    id: 'frontend',
    name: 'Frontend',
    role: 'Browser UX',
    voiceId: 'af_bella',
    summary: 'Focuses on the web UI, rendering, controls, and session ergonomics.'
  }
];

const agentMap = new Map(agentRegistry.map((agent) => [agent.id, agent]));

function getClient(config) {
  if (!sharedClient) {
    sharedClient = new CodexAppServerClient({
      config: {
        codexBinary: config.codexBinary || 'codex',
        codexCwd: config.codexCwd || repoRoot
      }
    });
  }

  return sharedClient;
}

function normalizeSkills(entries = []) {
  return entries.flatMap((entry) => entry.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope,
    enabled: skill.enabled,
    cwd: entry.cwd
  })));
}

function normalizeApps(apps = []) {
  return apps.map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    is_accessible: app.isAccessible,
    is_enabled: app.isEnabled,
    plugin_display_names: app.pluginDisplayNames
  }));
}

function listRepoLocalSkills() {
  return repoSkillRegistry
    .filter((skill) => existsSync(skill.path))
    .map((skill) => ({
      ...skill,
      scope: 'project',
      enabled: true,
      cwd: repoRoot
    }));
}

function extractJsonObject(text) {
  const source = (text || '').trim();
  const direct = source.startsWith('{') ? source : source.slice(source.indexOf('{'));

  if (!direct || !direct.startsWith('{')) {
    throw new Error('Codex reply did not contain a JSON object.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < direct.length; index += 1) {
    const char = direct[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return direct.slice(0, index + 1);
      }
    }
  }

  throw new Error('Codex reply JSON object was incomplete.');
}

function parseStructuredReply(text) {
  const parsed = JSON.parse(extractJsonObject(text));

  if (typeof parsed.spoken_text !== 'string' || typeof parsed.artifact_text !== 'string' || !Array.isArray(parsed.topics)) {
    throw new Error('Codex reply did not match the expected voice schema.');
  }

  return {
    spokenText: parsed.spoken_text.trim(),
    artifactText: parsed.artifact_text.trim(),
    topics: parsed.topics.map((topic) => String(topic))
  };
}

function fallbackTopics(transcript) {
  const text = (transcript || '').toLowerCase();
  const topics = [];

  if (/\bvoice|audio|tts|asr|transcript|whisper|kokoro\b/.test(text)) {
    topics.push('voice');
  }
  if (/\bweb|ui|browser|react|next\b/.test(text)) {
    topics.push('frontend');
  }
  if (/\bsession|turn|event|state|transport|websocket\b/.test(text)) {
    topics.push('orchestration');
  }
  if (/\barchitecture|service|boundary|design|repo|codebase\b/.test(text)) {
    topics.push('architecture');
  }

  return topics.length ? topics : ['architecture'];
}

export function listAgents() {
  return agentRegistry.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    voice_id: agent.voiceId,
    summary: agent.summary
  }));
}

export function resolveAgent(agentId) {
  return agentMap.get(agentId) || agentRegistry[0];
}

export async function codexRoutingConfigured(config = {}) {
  try {
    const client = getClient(config);
    const auth = await client.sendRequest('getAuthStatus', {});
    return Boolean(auth.authMethod || auth.authToken || auth.requiresOpenaiAuth === false);
  } catch {
    return false;
  }
}

export function createFallbackAgentReply({ targetAgentId, transcript, error }) {
  const agent = resolveAgent(targetAgentId);
  const topics = fallbackTopics(transcript);

  return {
    gateway: gatewayAgent,
    agent,
    spokenText: `${agent.name} fallback: I could not reach the local Codex runtime, so this reply is a local placeholder for the ${agent.role.toLowerCase()} role.`,
    artifactText: [
      `Fallback role: ${agent.name}`,
      `Transcript: ${transcript || 'No transcript captured.'}`,
      `Reason: ${error || 'Unknown Codex runtime error.'}`,
      `Repo: ${repoRoot}`
    ].join('\n\n'),
    topics,
    provider: 'codex-fallback',
    mode: 'fallback',
    warning: error || null,
    threadId: null,
    skillsUsed: []
  };
}

export async function discoverCodexWorkspace({ config = {} } = {}) {
  try {
    const client = getClient(config);
    const [auth, skillsResponse, appsResponse] = await Promise.all([
      client.sendRequest('getAuthStatus', {}),
      client.sendRequest('skills/list', {
        cwds: [config.codexCwd || repoRoot],
        forceReload: true
      }),
      client.sendRequest('app/list', {
        limit: 50
      })
    ]);

    const mergedSkills = [...normalizeSkills(skillsResponse.data), ...listRepoLocalSkills()];

    return {
      codex: {
        configured: true,
        auth_method: auth.authMethod,
        requires_openai_auth: auth.requiresOpenaiAuth,
        cwd: config.codexCwd || repoRoot
      },
      skills: mergedSkills,
      apps: normalizeApps(appsResponse.data),
      warning: null
    };
  } catch (error) {
    return {
      codex: {
        configured: false,
        auth_method: null,
        requires_openai_auth: null,
        cwd: config.codexCwd || repoRoot
      },
      skills: [],
      apps: [],
      warning: error instanceof Error ? error.message : 'Unable to discover Codex workspace state.'
    };
  }
}

function buildRoleInstructions(agent) {
  return [
    `You are ${agent.name} for the Palpa voice dogfood repo.`,
    `Role focus: ${agent.role}. ${agent.summary}`,
    'You are operating inside a voice collaboration surface.',
    'Use the repository and available tools directly when they materially improve the answer.',
    'Your final assistant message must be JSON only and must satisfy the provided output schema.'
  ].join(' ');
}

function buildTurnPrompt(agent, transcript) {
  return [
    `Selected role: ${agent.name}`,
    `Transcript from the human: ${transcript}`,
    'Reply as the selected role.',
    'Keep spoken_text short and natural for TTS.',
    'Put denser implementation detail in artifact_text.',
    'Use topics to label the main areas of concern.'
  ].join('\n\n');
}

function buildSandboxPolicy(config) {
  return {
    type: 'workspaceWrite',
    writableRoots: [config.codexCwd || repoRoot],
    networkAccess: config.codexNetworkAccess !== false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

async function ensureRoleThread({ client, sessionState, targetAgentId, config }) {
  const agent = resolveAgent(targetAgentId);
  const existingThreadId = sessionState.threadsByAgentId.get(agent.id);

  if (existingThreadId) {
    return existingThreadId;
  }

  const response = await client.sendRequest('thread/start', {
    cwd: config.codexCwd || repoRoot,
    approvalPolicy: config.codexApprovalPolicy || 'never',
    sandbox: config.codexSandboxMode || 'workspace-write',
    model: config.codexModel || null,
    personality: 'pragmatic',
    developerInstructions: buildRoleInstructions(agent),
    serviceName: 'palpa-voice'
  });

  sessionState.threadsByAgentId.set(agent.id, response.thread.id);
  return response.thread.id;
}

function buildSkillInputs(agentId, sessionState) {
  const skills = [];

  for (const name of ['voice-mode', roleSkillNameByAgentId[agentId]]) {
    if (!name) {
      continue;
    }

    const skill = sessionState.skillsByName.get(name);
    if (skill) {
      skills.push({
        type: 'skill',
        name: skill.name,
        path: skill.path
      });
    }
  }

  return skills;
}

function findTurn(turns, turnId) {
  return (turns || []).find((turn) => turn.id === turnId) || null;
}

function extractFinalAgentMessage(turn) {
  const messages = (turn?.items || []).filter((item) => item.type === 'agentMessage' && item.text?.trim());
  return messages.length ? messages.at(-1).text.trim() : '';
}

async function waitForTurnCompleted(client, { threadId, turnId, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for Codex turn completion.'));
    }, timeoutMs);

    const unsubscribe = client.onNotification((message) => {
      if (message.method === 'turn/completed' && message.params.threadId === threadId && message.params.turn.id === turnId) {
        clearTimeout(timer);
        unsubscribe();
        resolve(message.params.turn);
      }

      if (message.method === 'error') {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(message.params.message || 'Codex app-server reported an error.'));
      }
    });
  });
}

export async function generateAgentReply({ sessionState, targetAgentId, transcript, config = {} }) {
  try {
    const client = getClient(config);
    const agent = resolveAgent(targetAgentId);
    const threadId = await ensureRoleThread({ client, sessionState, targetAgentId: agent.id, config });
    const skillsUsed = buildSkillInputs(agent.id, sessionState);
    const response = await client.sendRequest('turn/start', {
      threadId,
      input: [
        ...skillsUsed,
        {
          type: 'text',
          text: buildTurnPrompt(agent, transcript),
          text_elements: []
        }
      ],
      cwd: config.codexCwd || repoRoot,
      approvalPolicy: config.codexApprovalPolicy || 'never',
      sandboxPolicy: buildSandboxPolicy(config),
      model: config.codexModel || null,
      personality: 'pragmatic',
      outputSchema: replyOutputSchema
    });

    await waitForTurnCompleted(client, {
      threadId,
      turnId: response.turn.id,
      timeoutMs: config.codexTurnTimeoutMs || 30000
    });

    const threadRead = await client.sendRequest('thread/read', {
      threadId,
      includeTurns: true
    });

    const completedTurn = findTurn(threadRead.thread.turns, response.turn.id);
    const messageText = extractFinalAgentMessage(completedTurn);
    const structured = parseStructuredReply(messageText);

    return {
      gateway: gatewayAgent,
      agent,
      spokenText: structured.spokenText,
      artifactText: structured.artifactText,
      topics: structured.topics,
      provider: 'codex-app-server',
      mode: 'live',
      warning: null,
      threadId,
      skillsUsed: skillsUsed.map((skill) => skill.name)
    };
  } catch (error) {
    return createFallbackAgentReply({
      targetAgentId,
      transcript,
      error: error instanceof Error ? error.message : 'Codex runtime error.'
    });
  }
}
