import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { EventFanout } from './stream.js';

function createJsonRpcError(message, code = -32000) {
  return {
    jsonrpc: '2.0',
    error: { code, message }
  };
}

function normalizeStatus(status) {
  if (!status) {
    return null;
  }

  if (typeof status === 'string') {
    return status;
  }

  if (typeof status === 'object' && typeof status.type === 'string') {
    return status.type;
  }

  return null;
}

function mapInputItem(item) {
  switch (item.type) {
    case 'text':
      return {
        type: 'text',
        text: item.text,
        text_elements: []
      };
    case 'image':
      return {
        type: 'image',
        image_url: item.imageUrl,
        mime_type: item.mimeType || null
      };
    case 'attachment':
      return {
        type: 'local_image',
        path: item.uri
      };
    case 'context':
      return {
        type: 'text',
        text: `${item.label}:\n${item.value}`,
        text_elements: []
      };
    default:
      return item;
  }
}

function mapDecision(decision) {
  switch (decision.type) {
    case 'approve':
      return { decision: 'accept' };
    case 'approve_for_session':
      return { decision: 'acceptForSession' };
    case 'reject':
      return { decision: 'decline' };
    case 'cancel':
      return { decision: 'cancel' };
    case 'approve_with_changes':
      return {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: decision.command || []
          }
        }
      };
    default:
      throw new Error(`Unsupported approval decision type ${decision.type}.`);
  }
}

export class CodexProvider {
  constructor({
    config = {},
    spawnProcess = spawn
  } = {}) {
    this.id = 'codex';
    this.capabilities = {
      supportsSessionBinding: true,
      supportsApprovals: true,
      supportsFileApprovals: true,
      supportsRunInterrupt: true,
      supportsSessionList: true,
      supportsArchive: true
    };

    this.config = config;
    this.spawnProcess = spawnProcess;
    this.process = null;
    this.stdoutInterface = null;
    this.stderrInterface = null;
    this.initialized = false;
    this.initializePromise = null;
    this.requestId = 0;
    this.pending = new Map();
    this.events = new EventFanout();
    this.pendingApprovals = new Map();
    this.itemContexts = new Map();
    this.stderr = [];
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (!this.initializePromise) {
      this.initializePromise = this.startProcess();
    }

    await this.initializePromise;
  }

  async shutdown() {
    this.initialized = false;
    this.initializePromise = null;
    this.rejectAll(new Error('Codex provider shut down.'));
    this.events.close();
    this.pendingApprovals.clear();
    this.itemContexts.clear();

    if (this.stdoutInterface) {
      this.stdoutInterface.close();
      this.stdoutInterface = null;
    }

    if (this.stderrInterface) {
      this.stderrInterface.close();
      this.stderrInterface = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  async createSession({ title = null, cwd = null, metadata = {}, providerSessionId = null } = {}) {
    await this.initialize();

    if (providerSessionId) {
      return this.bindSession({ providerSessionId, title, cwd, metadata });
    }

    const result = await this.sendRequest('thread/start', {
      cwd: cwd || this.config.codexCwd || null,
      model: metadata.model || this.config.codexModel || null,
      approvalPolicy: metadata.approvalPolicy || this.config.codexApprovalPolicy || null,
      sandboxPolicy: metadata.sandboxPolicy || this.config.codexSandboxPolicy || null,
      developerInstructions: metadata.developerInstructions || null,
      title
    });

    return this.mapThreadHandle(result.thread, { cwd, title });
  }

  async bindSession({ providerSessionId, title = null, cwd = null }) {
    await this.initialize();
    const result = await this.sendRequest('thread/read', {
      threadId: providerSessionId,
      includeTurns: false
    });

    return this.mapThreadHandle(result.thread, { cwd, title });
  }

  async resumeSession({ providerSessionId, cwd = null, metadata = {} }) {
    await this.initialize();
    const result = await this.sendRequest('thread/resume', {
      threadId: providerSessionId,
      cwd: cwd || this.config.codexCwd || null,
      model: metadata.model || this.config.codexModel || null,
      approvalPolicy: metadata.approvalPolicy || this.config.codexApprovalPolicy || null,
      sandboxPolicy: metadata.sandboxPolicy || this.config.codexSandboxPolicy || null
    });

    return this.mapThreadHandle(result.thread, { cwd, title: null });
  }

  async archiveSession({ providerSessionId }) {
    await this.initialize();
    await this.sendRequest('thread/archive', {
      threadId: providerSessionId
    });
  }

  async listSessions({ limit = 50, cursor = null, archived = false } = {}) {
    await this.initialize();
    const result = await this.sendRequest('thread/list', {
      limit,
      cursor,
      archived
    });

    return (result.data || []).map((thread) => this.mapThreadHandle(thread, {}));
  }

  async getAuthStatus() {
    await this.initialize();
    return this.sendRequest('getAuthStatus', {});
  }

  async listSkills({ cwds = [], forceReload = false } = {}) {
    await this.initialize();
    return this.sendRequest('skills/list', {
      cwds,
      forceReload
    });
  }

  async listApps({ limit = 50 } = {}) {
    await this.initialize();
    return this.sendRequest('app/list', { limit });
  }

  async readThread({ providerSessionId, includeTurns = true } = {}) {
    await this.initialize();
    return this.sendRequest('thread/read', {
      threadId: providerSessionId,
      includeTurns
    });
  }

  async request(method, params) {
    await this.initialize();
    return this.sendRequest(method, params);
  }

  async createRun({ sessionId, runId, providerSessionId, input, metadata = {} }) {
    await this.initialize();

    const result = await this.sendRequest('turn/start', {
      threadId: providerSessionId,
      input: input.map(mapInputItem),
      cwd: metadata.cwd || this.config.codexCwd || null,
      model: metadata.model || this.config.codexModel || null,
      approvalPolicy: metadata.approvalPolicy || this.config.codexApprovalPolicy || null,
      sandboxPolicy: metadata.sandboxPolicy || this.config.codexSandboxPolicy || null,
      outputSchema: metadata.outputSchema || null
    });

    return {
      providerRunId: result.turn.id,
      providerSessionId,
      sessionId,
      runId,
      metadata: {
        turnStatus: normalizeStatus(result.turn.status)
      }
    };
  }

  async interruptRun({ runId, providerSessionId }) {
    await this.initialize();
    await this.sendRequest('turn/interrupt', {
      threadId: providerSessionId,
      turnId: runId
    });
  }

  async respondToApproval({ approvalId, decision }) {
    await this.initialize();
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Unknown approval ${approvalId}.`);
    }

    this.write({
      jsonrpc: '2.0',
      id: pending.requestId,
      result: mapDecision(decision)
    });
  }

  stream() {
    return this.events.subscribe();
  }

  async startProcess() {
    this.process = this.spawnProcess(this.config.codexBinary || 'codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.config.codexCwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.on('error', (error) => {
      this.rejectAll(error);
    });

    this.process.on('exit', (code, signal) => {
      this.initialized = false;
      this.initializePromise = null;
      this.rejectAll(new Error(`Codex app-server exited (${code ?? 'null'}${signal ? `, ${signal}` : ''}).`));
    });

    this.stdoutInterface = readline.createInterface({ input: this.process.stdout });
    this.stdoutInterface.on('line', (line) => {
      if (line.trim()) {
        this.handleMessage(line);
      }
    });

    this.stderrInterface = readline.createInterface({ input: this.process.stderr });
    this.stderrInterface.on('line', (line) => {
      if (line.trim()) {
        this.stderr.push(line);
      }
    });

    await this.sendRequest('initialize', {
      clientInfo: {
        name: this.config.clientName || 'palpa',
        title: this.config.clientTitle || 'Palpa',
        version: this.config.clientVersion || '0.1.0'
      },
      capabilities: {
        experimentalApi: this.config.experimentalApi !== false
      }
    }, { skipInitialize: true });

    this.write({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {}
    });

    this.initialized = true;
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);

    if (Object.prototype.hasOwnProperty.call(message, 'id') && (Object.prototype.hasOwnProperty.call(message, 'result') || Object.prototype.hasOwnProperty.call(message, 'error'))) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Codex app-server request failed.'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message);
    }
  }

  handleServerRequest(message) {
    const mapped = this.mapApprovalRequest(message);
    if (!mapped) {
      const error = createJsonRpcError(`Unsupported interactive request ${message.method}.`, -32601);
      this.write({ ...error, id: message.id });
      return;
    }

    this.pendingApprovals.set(mapped.approval.id, {
      requestId: message.id,
      method: message.method,
      sessionId: mapped.sessionId,
      runId: mapped.runId
    });
    this.events.push(mapped);
  }

  handleNotification(message) {
    const events = this.mapNotification(message);
    for (const event of events) {
      this.events.push(event);
    }
  }

  mapApprovalRequest(message) {
    const params = message.params || {};
    const approvalId = params.approvalId || `${params.threadId}:${params.turnId}:${params.itemId}:${message.id}`;
    const availableDecisions = (params.availableDecisions || []).map((decision) => {
      switch (decision) {
        case 'accept':
          return 'approve';
        case 'acceptForSession':
          return 'approve_for_session';
        case 'acceptWithExecpolicyAmendment':
          return 'approve_with_changes';
        case 'decline':
          return 'reject';
        case 'cancel':
          return 'cancel';
        default:
          return null;
      }
    }).filter(Boolean);

    if (message.method === 'item/commandExecution/requestApproval') {
      return {
        type: 'approval.requested',
        sessionId: params.threadId,
        runId: params.turnId,
        approval: {
          id: approvalId,
          kind: 'command',
          command: params.command || [],
          cwd: params.cwd || null,
          reason: params.reason || null,
          availableDecisions: availableDecisions.length ? availableDecisions : ['approve', 'approve_for_session', 'reject', 'cancel'],
          metadata: {
            itemId: params.itemId || null,
            commandActions: params.commandActions || [],
            networkApprovalContext: params.networkApprovalContext || null
          }
        }
      };
    }

    if (message.method === 'item/fileChange/requestApproval') {
      return {
        type: 'approval.requested',
        sessionId: params.threadId,
        runId: params.turnId,
        approval: {
          id: approvalId,
          kind: 'file',
          changes: params.changes || [],
          reason: params.reason || null,
          availableDecisions: availableDecisions.length ? availableDecisions : ['approve', 'approve_for_session', 'reject', 'cancel'],
          metadata: {
            itemId: params.itemId || null,
            grantRoot: params.grantRoot || null
          }
        }
      };
    }

    return null;
  }

  mapNotification(message) {
    const params = message.params || {};
    const method = message.method;
    const events = [];

    if (method === 'item/started' && params.item?.id) {
      this.itemContexts.set(params.item.id, {
        sessionId: params.threadId,
        runId: params.turnId,
        item: params.item
      });

      if (params.item.type === 'commandExecution') {
        events.push({
          type: 'command.started',
          sessionId: params.threadId,
          runId: params.turnId,
          argv: params.item.command || [],
          cwd: params.item.cwd || null,
          metadata: {
            itemId: params.item.id,
            commandActions: params.item.commandActions || []
          }
        });
      }

      if (params.item.type === 'mcpToolCall') {
        events.push({
          type: 'tool.started',
          sessionId: params.threadId,
          runId: params.turnId,
          toolName: params.item.tool || params.item.server || 'mcp_tool',
          metadata: {
            itemId: params.item.id,
            server: params.item.server || null,
            arguments: params.item.arguments || null
          }
        });
      }
    }

    if (method === 'item/agentMessage/delta') {
      events.push({
        type: 'message.delta',
        sessionId: params.threadId,
        runId: params.turnId,
        text: params.delta || '',
        metadata: {
          itemId: params.itemId || null
        }
      });
    }

    if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
      events.push({
        type: 'reasoning.delta',
        sessionId: params.threadId,
        runId: params.turnId,
        text: params.delta || params.text || '',
        metadata: {
          itemId: params.itemId || null
        }
      });
    }

    if (method === 'item/commandExecution/outputDelta') {
      events.push({
        type: 'command.output',
        sessionId: params.threadId,
        runId: params.turnId,
        stream: params.stream || 'stdout',
        chunk: params.outputDelta || params.delta || '',
        metadata: {
          itemId: params.itemId || null
        }
      });
    }

    if (method === 'item/fileChange/patchUpdated') {
      for (const change of params.changes || []) {
        events.push({
          type: 'file.updated',
          sessionId: params.threadId,
          runId: params.turnId,
          path: change.path,
          patch: change.diff || params.patch || null,
          metadata: {
            itemId: params.itemId || null,
            kind: change.kind || null
          }
        });
      }
    }

    if (method === 'turn/plan/updated') {
      events.push({
        type: 'plan.updated',
        sessionId: params.threadId || null,
        runId: params.turnId,
        steps: params.plan || [],
        metadata: {
          explanation: params.explanation || null
        }
      });
    }

    if (method === 'thread/status/changed') {
      events.push({
        type: 'session.updated',
        sessionId: params.threadId,
        status: normalizeStatus(params.status) || 'idle'
      });
    }

    if (method === 'item/completed' && params.item?.id) {
      const item = params.item;
      const context = this.itemContexts.get(item.id);
      if (item.type === 'agentMessage') {
        events.push({
          type: 'message.completed',
          sessionId: params.threadId,
          runId: params.turnId,
          role: 'assistant',
          text: item.text || '',
          metadata: {
            itemId: item.id
          }
        });
      }

      if (item.type === 'commandExecution') {
        events.push({
          type: 'command.completed',
          sessionId: params.threadId,
          runId: params.turnId,
          exitCode: item.exitCode ?? -1,
          metadata: {
            itemId: item.id,
            status: item.status || null,
            durationMs: item.durationMs ?? null,
            aggregatedOutput: item.aggregatedOutput || null
          }
        });
      }

      if (item.type === 'fileChange') {
        for (const change of item.changes || []) {
          events.push({
            type: 'file.updated',
            sessionId: params.threadId,
            runId: params.turnId,
            path: change.path,
            patch: change.diff || null,
            metadata: {
              itemId: item.id,
              kind: change.kind || null,
              status: item.status || null
            }
          });
        }
      }

      if (item.type === 'mcpToolCall') {
        events.push({
          type: 'tool.completed',
          sessionId: params.threadId,
          runId: params.turnId,
          toolName: item.tool || item.server || 'mcp_tool',
          status: item.status === 'failed' ? 'failed' : 'completed',
          metadata: {
            itemId: item.id,
            result: item.result || null,
            error: item.error || null
          }
        });
      }

      if (context) {
        this.itemContexts.delete(item.id);
      }
    }

    if (method === 'turn/completed') {
      const turn = params.turn || {};
      events.push({
        type: 'run.completed',
        sessionId: params.threadId || this.findSessionIdForTurn(turn.id),
        runId: turn.id,
        status: this.mapRunStatus(normalizeStatus(turn.status)),
        metadata: {
          error: turn.error || null
        }
      });
    }

    if (method === 'serverRequest/resolved') {
      const approval = [...this.pendingApprovals.entries()].find(([, pending]) => pending.requestId === params.requestId);
      if (approval) {
        this.pendingApprovals.delete(approval[0]);
      }
    }

    if (method === 'error') {
      const error = params.error || {};
      events.push({
        type: 'error',
        sessionId: params.threadId || null,
        runId: params.turnId || null,
        code: error.codexErrorInfo || 'codex_error',
        message: error.message || 'Codex app-server error.',
        retryable: false
      });
    }

    return events.filter((event) => event.sessionId);
  }

  mapThreadHandle(thread = {}, { cwd = null, title = null }) {
    return {
      providerSessionId: thread.id,
      title: thread.name || title,
      cwd: thread.cwd || cwd,
      metadata: {
        status: normalizeStatus(thread.status),
        path: thread.path || null,
        ephemeral: Boolean(thread.ephemeral)
      }
    };
  }

  mapRunStatus(status) {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'interrupted':
        return 'interrupted';
      case 'failed':
        return 'failed';
      default:
        return 'completed';
    }
  }

  findSessionIdForTurn(turnId) {
    for (const context of this.itemContexts.values()) {
      if (context.runId === turnId) {
        return context.sessionId;
      }
    }

    for (const pending of this.pendingApprovals.values()) {
      if (pending.runId === turnId) {
        return pending.sessionId;
      }
    }

    return null;
  }

  rejectAll(error) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }

    this.pending.clear();
  }

  write(message) {
    if (!this.process?.stdin?.writable) {
      throw new Error('Codex app-server stdin is not writable.');
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async sendRequest(method, params, { skipInitialize = false } = {}) {
    if (!skipInitialize) {
      await this.initialize();
    }

    const id = ++this.requestId;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      try {
        this.write(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}
