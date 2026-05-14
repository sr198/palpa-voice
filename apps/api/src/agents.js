import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { getCodexProvider, initializeAgentRuntime } from './agent-runtime.js';
import { buildCodexSandboxPolicy } from './codex-settings.js';

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
  required: ['spoken_text', 'should_speak', 'delivery_mode', 'artifact', 'topics', 'next_agent_suggestions'],
  properties: {
    spoken_text: { type: 'string' },
    should_speak: { type: 'boolean' },
    delivery_mode: {
      type: 'string',
      enum: ['voice', 'visual', 'voice_and_visual']
    },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'render_mode', 'files_touched', 'commands_run', 'tool_activity', 'diff_summary'],
      properties: {
        text: { type: 'string' },
        render_mode: {
          type: 'string',
          enum: ['plain_text', 'markdown', 'checklist']
        },
        files_touched: {
          type: 'array',
          items: { type: 'string' }
        },
        commands_run: {
          type: 'array',
          items: { type: 'string' }
        },
        tool_activity: {
          type: 'array',
          items: { type: 'string' }
        },
        diff_summary: { type: 'string' }
      }
    },
    topics: {
      type: 'array',
      items: { type: 'string' }
    },
    next_agent_suggestions: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

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

  const artifact = parsed.artifact && typeof parsed.artifact === 'object'
    ? parsed.artifact
    : {
        text: typeof parsed.artifact_text === 'string' ? parsed.artifact_text : '',
        render_mode: 'plain_text',
        files_touched: [],
        commands_run: [],
        tool_activity: [],
        diff_summary: ''
      };

  if (
    typeof parsed.spoken_text !== 'string'
    || typeof artifact.text !== 'string'
    || !Array.isArray(parsed.topics)
  ) {
    throw new Error('Codex reply did not match the expected voice schema.');
  }

  return {
    spokenText: parsed.spoken_text.trim(),
    shouldSpeak: parsed.should_speak !== false,
    deliveryMode: parsed.delivery_mode || 'voice_and_visual',
    artifact: {
      text: artifact.text.trim(),
      renderMode: artifact.render_mode || 'plain_text',
      filesTouched: Array.isArray(artifact.files_touched) ? artifact.files_touched.map((value) => String(value)) : [],
      commandsRun: Array.isArray(artifact.commands_run) ? artifact.commands_run.map((value) => String(value)) : [],
      toolActivity: Array.isArray(artifact.tool_activity) ? artifact.tool_activity.map((value) => String(value)) : [],
      diffSummary: typeof artifact.diff_summary === 'string' ? artifact.diff_summary.trim() : ''
    },
    topics: parsed.topics.map((topic) => String(topic)),
    nextAgentSuggestions: Array.isArray(parsed.next_agent_suggestions)
      ? parsed.next_agent_suggestions.map((value) => String(value))
      : []
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

export function listAgentIds() {
  return agentRegistry.map((agent) => agent.id);
}

export function resolveAgent(agentId) {
  return agentMap.get(agentId) || agentRegistry[0];
}

export async function codexRoutingConfigured(config = {}) {
  try {
    const auth = await getCodexProvider(config).getAuthStatus();
    return Boolean(auth.authMethod || auth.authToken || auth.requiresOpenaiAuth === false);
  } catch {
    return false;
  }
}

export function createFallbackAgentReply({ targetAgentId, transcript, error }) {
  const agent = resolveAgent(targetAgentId);
  const topics = fallbackTopics(transcript);
  const artifactText = [
    `Fallback role: ${agent.name}`,
    `Transcript: ${transcript || 'No transcript captured.'}`,
    `Reason: ${error || 'Unknown Codex runtime error.'}`,
    `Repo: ${repoRoot}`
  ].join('\n\n');

  return {
    gateway: gatewayAgent,
    agent,
    spokenText: `${agent.name} fallback: I could not reach the local Codex runtime, so this reply is a local placeholder for the ${agent.role.toLowerCase()} role.`,
    shouldSpeak: true,
    deliveryMode: 'voice_and_visual',
    artifact: {
      text: artifactText,
      renderMode: 'plain_text',
      filesTouched: [],
      commandsRun: [],
      toolActivity: [],
      diffSummary: ''
    },
    artifactText,
    topics,
    nextAgentSuggestions: listAgentIds(),
    provider: 'codex-fallback',
    mode: 'fallback',
    warning: error || null,
    threadId: null,
    skillsUsed: []
  };
}

export async function discoverCodexWorkspace({ config = {} } = {}) {
  try {
    const provider = getCodexProvider(config);
    const [auth, skillsResponse, appsResponse] = await Promise.all([
      provider.getAuthStatus(),
      provider.listSkills({
        cwds: [config.codexCwd || repoRoot],
        forceReload: true
      }),
      provider.listApps({
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
    'The supervisor manages the floor, but this selected role owns the current answer.',
    'If the answer should be spoken, keep spoken_text short and natural for TTS.',
    'If the answer should not be spoken, set should_speak to false and keep spoken_text empty or minimal.',
    'Put denser implementation detail in artifact.text.',
    'Use next_agent_suggestions to name which specialist ids would make sense to call next.',
    `Valid next agent ids: ${listAgentIds().join(', ')}.`,
    'Use topics to label the main areas of concern.'
  ].join('\n\n');
}

async function ensureRoleSession({ runtime, sessionState, targetAgentId, config }) {
  const agent = resolveAgent(targetAgentId);
  const existingSessionId = sessionState.threadsByAgentId.get(agent.id);

  if (existingSessionId) {
    const session = await runtime.resumeSession(existingSessionId);
    return session;
  }

  const session = await runtime.createSession({
    title: `${agent.name} role session`,
    cwd: config.codexCwd || repoRoot,
    metadata: {
      model: config.codexModel || null,
      approvalPolicy: config.codexApprovalPolicy || 'never',
      sandboxPolicy: buildCodexSandboxPolicy(config),
      developerInstructions: buildRoleInstructions(agent)
    }
  });

  sessionState.threadsByAgentId.set(agent.id, session.id);
  return session;
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

function mapRuntimeEvent(event, { threadId, turnId }) {
  if (event.type === 'message.delta') {
    return {
      type: 'activity',
      stage: 'thinking',
      activity: {
        kind: 'agent_message_delta',
        text: event.text || '',
        item_id: event.metadata?.itemId || null
      }
    };
  }

  if (event.type === 'command.started') {
    return {
      type: 'activity',
      stage: 'tool_running',
      activity: {
        kind: 'command_started',
        command: Array.isArray(event.argv) ? event.argv.join(' ') : '',
        cwd: event.cwd || null
      }
    };
  }

  if (event.type === 'command.output') {
    return {
      type: 'activity',
      stage: 'tool_running',
      activity: {
        kind: 'command_output',
        output: event.chunk || '',
        stream: event.stream || 'stdout'
      }
    };
  }

  if (event.type === 'tool.started' || event.type === 'tool.completed') {
    return {
      type: 'activity',
      stage: 'tool_running',
      activity: {
        kind: 'mcp_tool_progress',
        tool_name: event.toolName || null,
        status: event.status || (event.type === 'tool.started' ? 'inProgress' : 'completed'),
        detail: event.metadata?.error ? String(event.metadata.error) : ''
      }
    };
  }

  if (event.type === 'file.updated') {
    return {
      type: 'activity',
      stage: 'editing',
      activity: {
        kind: 'file_change',
        path: event.path || null,
        patch: event.patch || ''
      }
    };
  }

  if (event.type === 'plan.updated') {
    return {
      type: 'activity',
      stage: 'thinking',
      activity: {
        kind: 'plan_update',
        plan: event.steps || [],
        explanation: event.metadata?.explanation || ''
      }
    };
  }

  if (event.type === 'approval.requested') {
    return {
      type: 'activity',
      stage: 'tool_running',
      activity: {
        kind: 'approval_requested',
        approval_id: event.approval.id,
        approval_kind: event.approval.kind
      }
    };
  }

  if (event.type === 'run.completed') {
    if (event.status === 'failed') {
      return {
        type: 'stage',
        stage: 'failed',
        threadId,
        turnId,
        error: event.metadata?.error?.message || null
      };
    }

    return {
      type: 'stage',
      stage: 'reply_ready',
      threadId,
      turnId
    };
  }

  if (event.type === 'error') {
    return {
      type: 'stage',
      stage: 'failed',
      threadId,
      turnId,
      error: event.message || 'Codex runtime error.'
    };
  }

  return null;
}

async function waitForRunCompleted(runtime, { runtimeSessionId, runtimeRunId, threadId, turnId, cursor, timeoutMs = 30000, onEvent }) {
  const abortController = new AbortController();

  try {
    const iterator = runtime.subscribe(runtimeSessionId, {
      cursor,
      signal: abortController.signal
    });

    const result = await Promise.race([
      (async () => {
        let finalMessageText = '';

        for await (const entry of iterator) {
          const event = entry.event;
          if (event.runId && event.runId !== runtimeRunId) {
            continue;
          }

          const mappedEvent = mapRuntimeEvent(event, { threadId, turnId });
          if (mappedEvent) {
            onEvent?.({
              ...mappedEvent,
              threadId,
              turnId
            });
          }

          if (event.type === 'message.completed' && event.role === 'assistant') {
            finalMessageText = event.text || finalMessageText;
          }

          if (event.type === 'run.completed' && event.runId === runtimeRunId) {
            return {
              status: event.status,
              messageText: finalMessageText
            };
          }

          if (event.type === 'error' && event.runId === runtimeRunId) {
            throw new Error(event.message || 'Codex runtime error.');
          }
        }

        throw new Error('Codex run stream ended unexpectedly.');
      })(),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error('Timed out waiting for Codex turn completion.'));
        }, timeoutMs);
      })
    ]);

    return result;
  } finally {
    abortController.abort();
  }
}

export async function generateAgentReply({ sessionState, targetAgentId, transcript, config = {}, onEvent }) {
  try {
    const runtime = await initializeAgentRuntime(config);
    const provider = getCodexProvider(config);
    const agent = resolveAgent(targetAgentId);
    onEvent?.({ type: 'stage', stage: 'routing' });
    const roleSession = await ensureRoleSession({ runtime, sessionState, targetAgentId: agent.id, config });
    const threadId = roleSession.binding.providerSessionId;
    const skillsUsed = buildSkillInputs(agent.id, sessionState);
    onEvent?.({
      type: 'activity',
      stage: 'routing',
      activity: {
        kind: 'skill_attachment',
        skills: skillsUsed.map((skill) => skill.name),
        thread_id: threadId
      }
    });

    const history = await runtime.getSessionHistory(roleSession.id);
    const cursor = history.at(-1)?.cursor;
    const run = await runtime.createRun({
      sessionId: roleSession.id,
      input: [
        ...skillsUsed,
        {
          type: 'text',
          text: buildTurnPrompt(agent, transcript),
        }
      ],
      metadata: {
        cwd: config.codexCwd || repoRoot,
        approvalPolicy: config.codexApprovalPolicy || 'never',
        sandboxPolicy: buildCodexSandboxPolicy(config),
        model: config.codexModel || null,
        outputSchema: replyOutputSchema
      }
    });
    const providerTurnId = run.binding?.providerRunId || run.id;
    onEvent?.({
      type: 'stage',
      stage: 'thinking',
      threadId,
      turnId: providerTurnId
    });

    const completedRun = await waitForRunCompleted(runtime, {
      runtimeSessionId: roleSession.id,
      runtimeRunId: run.id,
      threadId,
      turnId: providerTurnId,
      cursor,
      timeoutMs: config.codexTurnTimeoutMs || 30000,
      onEvent: (event) => onEvent?.({
        ...event,
        threadId,
        turnId: providerTurnId
      })
    });

    let messageText = completedRun.messageText;
    if (!messageText) {
      const threadRead = await provider.readThread({
        providerSessionId: threadId,
        includeTurns: true
      });
      const turns = threadRead.thread?.turns || [];
      const completedTurn = turns.find((turn) => turn.id === providerTurnId) || turns.at(-1) || null;
      const item = (completedTurn?.items || []).findLast?.((entry) => entry?.type === 'agentMessage')
        || [...(completedTurn?.items || [])].reverse().find((entry) => entry?.type === 'agentMessage')
        || null;
      messageText = item?.text || '';
    }

    const structured = parseStructuredReply(messageText);

    return {
      gateway: gatewayAgent,
      agent,
      spokenText: structured.spokenText,
      shouldSpeak: structured.shouldSpeak,
      deliveryMode: structured.deliveryMode,
      artifact: structured.artifact,
      artifactText: structured.artifact.text,
      topics: structured.topics,
      nextAgentSuggestions: structured.nextAgentSuggestions.filter((agentId) => agentMap.has(agentId)),
      provider: 'codex-app-server',
      mode: 'live',
      warning: null,
      threadId,
      skillsUsed: skillsUsed.map((skill) => skill.name)
    };
  } catch (error) {
    onEvent?.({
      type: 'stage',
      stage: 'failed',
      error: error instanceof Error ? error.message : 'Codex runtime error.'
    });
    return createFallbackAgentReply({
      targetAgentId,
      transcript,
      error: error instanceof Error ? error.message : 'Codex runtime error.'
    });
  }
}
