import { discoverCodexWorkspace, gatewayAgent, listAgents, resolveAgent } from './agents.js';
import { initializeAgentRuntime } from './agent-runtime.js';
import { buildCodexSandboxPolicy, repoRoot } from './codex-settings.js';

function buildChatInstructions(agent) {
  return [
    `You are ${agent.name} for the Palpa repo.`,
    `Role focus: ${agent.role}. ${agent.summary}`,
    'You are operating inside the Palpa chat surface.',
    'Use repository context and tools directly when they materially improve the answer.',
    'Respond naturally in chat. Do not force a voice-specific JSON format.',
    'Keep the final reply concise, and let runtime events communicate detailed tool activity.'
  ].join(' ');
}

function serializeSession(session) {
  const agentId = session.metadata?.agentId || 'architect';
  const agent = resolveAgent(agentId);

  return {
    id: session.id,
    title: session.title,
    provider: session.providerId,
    status: session.status,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      summary: agent.summary
    },
    thread_id: session.binding?.providerSessionId || null,
    metadata: {
      agentId: agent.id,
      model: session.metadata?.model || null,
      approvalPolicy: session.metadata?.approvalPolicy || null
    }
  };
}

function normalizeRunInput({ text, input }) {
  if (Array.isArray(input) && input.length) {
    return input;
  }

  if (typeof text === 'string' && text.trim()) {
    return [{ type: 'text', text: text.trim() }];
  }

  throw new Error('Chat run requires either a non-empty text field or a typed input array.');
}

export class ChatService {
  constructor({
    config,
    runtimeFactory = initializeAgentRuntime,
    workspaceFactory = discoverCodexWorkspace
  }) {
    this.config = config;
    this.runtimeFactory = runtimeFactory;
    this.workspaceFactory = workspaceFactory;
    this.runtimePromise = null;
  }

  async getRuntime() {
    if (!this.runtimePromise) {
      this.runtimePromise = this.runtimeFactory(this.config);
    }

    return this.runtimePromise;
  }

  async getBootstrap() {
    const workspace = await this.workspaceFactory({ config: this.config });
    return {
      gateway: {
        id: gatewayAgent.id,
        name: gatewayAgent.name,
        role: gatewayAgent.role
      },
      agents: listAgents(),
      codex: {
        configured: workspace.codex.configured,
        auth_method: workspace.codex.auth_method,
        cwd: workspace.codex.cwd,
        warning: workspace.warning,
        model: this.config.codexModel || null
      },
      skills: workspace.skills,
      apps: workspace.apps,
      warning: workspace.warning
    };
  }

  async createSession({ title = null, agentId = 'architect' } = {}) {
    const runtime = await this.getRuntime();
    const agent = resolveAgent(agentId);
    const session = await runtime.createSession({
      title: title || `${agent.name} chat`,
      cwd: this.config.codexCwd || repoRoot,
      metadata: {
        agentId: agent.id,
        model: this.config.codexModel || null,
        approvalPolicy: this.config.codexApprovalPolicy || 'never',
        sandboxPolicy: buildCodexSandboxPolicy(this.config),
        developerInstructions: buildChatInstructions(agent)
      }
    });

    return serializeSession(session);
  }

  async listSessions() {
    const runtime = await this.getRuntime();
    const sessions = await runtime.listSessions();
    return sessions.map(serializeSession);
  }

  async getSession(sessionId) {
    const sessions = await this.listSessions();
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      throw new Error(`Unknown chat session ${sessionId}.`);
    }

    return session;
  }

  async getHistory(sessionId, { cursor } = {}) {
    const runtime = await this.getRuntime();
    await this.getSession(sessionId);
    return runtime.getSessionHistory(sessionId, { cursor });
  }

  async startRun(sessionId, { text, input, metadata = {} } = {}) {
    const runtime = await this.getRuntime();
    const session = await this.getSession(sessionId);
    const normalizedInput = normalizeRunInput({ text, input });
    const run = await runtime.createRun({
      sessionId,
      input: normalizedInput,
      metadata: {
        cwd: this.config.codexCwd || repoRoot,
        approvalPolicy: this.config.codexApprovalPolicy || 'never',
        sandboxPolicy: buildCodexSandboxPolicy(this.config),
        model: this.config.codexModel || null,
        ...metadata
      }
    });

    return {
      id: run.id,
      session_id: sessionId,
      status: run.status,
      created_at: run.createdAt,
      started_at: run.startedAt,
      turn_id: run.binding?.providerRunId || null,
      agent_id: session.metadata.agentId
    };
  }

  async interruptRun(sessionId, runId) {
    const runtime = await this.getRuntime();
    await this.getSession(sessionId);
    await runtime.interruptRun(sessionId, runId);
  }

  async respondToApproval(sessionId, runId, approvalId, decision) {
    const runtime = await this.getRuntime();
    await this.getSession(sessionId);
    await runtime.respondToApproval(sessionId, runId, approvalId, decision);
  }

  async subscribe(sessionId, options = {}) {
    const runtime = await this.getRuntime();
    await this.getSession(sessionId);
    return runtime.subscribe(sessionId, options);
  }
}
