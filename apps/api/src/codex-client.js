import { spawn } from 'node:child_process';
import readline from 'node:readline';

function createJsonRpcError(message, code = -32000) {
  return {
    jsonrpc: '2.0',
    error: { code, message }
  };
}

export class CodexAppServerClient {
  constructor({ config, spawnProcess = spawn }) {
    this.config = config;
    this.spawnProcess = spawnProcess;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.notificationListeners = new Set();
    this.initializePromise = null;
    this.initialized = false;
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

  async startProcess() {
    this.process = this.spawnProcess(this.config.codexBinary || 'codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.config.codexCwd,
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

    readline.createInterface({ input: this.process.stdout }).on('line', (line) => {
      if (line.trim()) {
        this.handleMessage(line);
      }
    });

    readline.createInterface({ input: this.process.stderr }).on('line', (line) => {
      if (line.trim()) {
        this.stderr.push(line);
      }
    });

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'palpa-voice',
        title: 'Palpa Voice',
        version: '0.1.0'
      },
      capabilities: {
        experimentalApi: true
      }
    }, { skipInitialize: true });

    this.initialized = true;
  }

  rejectAll(error) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }

    this.pending.clear();
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
      for (const listener of this.notificationListeners) {
        listener(message);
      }
    }
  }

  handleServerRequest(message) {
    const error = createJsonRpcError(`Palpa voice cannot satisfy interactive server request ${message.method}.`);
    this.write({ ...error, id: message.id });
  }

  write(message) {
    if (!this.process?.stdin.writable) {
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

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  async close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.initialized = false;
    this.initializePromise = null;
  }
}
