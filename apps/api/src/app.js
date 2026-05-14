import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config as defaultConfig } from './config.js';
import { ChatService } from './chat-service.js';
import { SessionStore } from './session-store.js';
import { codexRoutingConfigured, discoverCodexWorkspace, gatewayAgent, listAgents } from './agents.js';

export async function buildApp({ config = defaultConfig, random = Math.random, chatService = null } = {}) {
  const app = Fastify();
  const store = new SessionStore({ config, random });
  const chats = chatService || new ChatService({ config });

  await app.register(cors, {
    origin: config.webOrigin
  });
  await app.register(websocket);

  app.get('/health', async () => {
    let voice = { ok: false };
    const [codexConfigured, codexWorkspace] = await Promise.all([
      codexRoutingConfigured(config),
      discoverCodexWorkspace({ config })
    ]);

    try {
      const response = await fetch(config.voiceHealthUrl);
      voice = await response.json();
    } catch {
      voice = { ok: false, error: 'voice service unreachable' };
    }

    return {
      ok: true,
      service: 'palpa-api',
      ports: { web: 3000, api: 3001, voice: 8000 },
      voice,
      codex: {
        configured: codexConfigured,
        model: config.codexModel || null,
        auth_method: codexWorkspace.codex.auth_method,
        cwd: codexWorkspace.codex.cwd,
        warning: codexWorkspace.warning
      },
      gateway: {
        id: gatewayAgent.id,
        name: gatewayAgent.name,
        role: gatewayAgent.role
      },
      agents: listAgents(),
      skills: codexWorkspace.skills,
      apps: codexWorkspace.apps
    };
  });

  app.get('/audio/:sessionId/:turnId', async (request, reply) => {
    reply.code(410);
    return { error: 'Audio route is not used in streaming mode.' };
  });

  app.get('/chat/bootstrap', async () => chats.getBootstrap());

  app.get('/chat/sessions', async () => ({
    sessions: await chats.listSessions()
  }));

  app.post('/chat/sessions', async (request, reply) => {
    try {
      const body = request.body || {};
      const session = await chats.createSession({
        title: typeof body.title === 'string' ? body.title : null,
        agentId: typeof body.agent_id === 'string' ? body.agent_id : 'architect'
      });
      reply.code(201);
      return { session };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to create chat session.' };
    }
  });

  app.get('/chat/sessions/:sessionId', async (request, reply) => {
    try {
      return {
        session: await chats.getSession(request.params.sessionId)
      };
    } catch (error) {
      reply.code(404);
      return { error: error instanceof Error ? error.message : 'Chat session not found.' };
    }
  });

  app.get('/chat/sessions/:sessionId/history', async (request, reply) => {
    try {
      return {
        events: await chats.getHistory(request.params.sessionId, {
          cursor: typeof request.query.cursor === 'string' ? request.query.cursor : undefined
        })
      };
    } catch (error) {
      reply.code(404);
      return { error: error instanceof Error ? error.message : 'Chat session not found.' };
    }
  });

  app.post('/chat/sessions/:sessionId/runs', async (request, reply) => {
    try {
      const body = request.body || {};
      const run = await chats.startRun(request.params.sessionId, {
        text: typeof body.text === 'string' ? body.text : undefined,
        input: Array.isArray(body.input) ? body.input : undefined,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      });
      reply.code(201);
      return { run };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to start chat run.' };
    }
  });

  app.post('/chat/sessions/:sessionId/runs/:runId/interrupt', async (request, reply) => {
    try {
      await chats.interruptRun(request.params.sessionId, request.params.runId);
      return { ok: true };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to interrupt chat run.' };
    }
  });

  app.post('/chat/sessions/:sessionId/runs/:runId/approvals/:approvalId', async (request, reply) => {
    try {
      const body = request.body || {};
      await chats.respondToApproval(
        request.params.sessionId,
        request.params.runId,
        request.params.approvalId,
        body.decision
      );
      return { ok: true };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to resolve approval.' };
    }
  });

  app.get('/chat/sessions/:sessionId/events', async (request, reply) => {
    try {
      const abortController = new AbortController();
      request.raw.on('close', () => abortController.abort());

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.hijack();

      const stream = await chats.subscribe(request.params.sessionId, {
        cursor: typeof request.query.cursor === 'string' ? request.query.cursor : undefined,
        signal: abortController.signal
      });

      reply.raw.write('event: ready\ndata: {"ok":true}\n\n');

      for await (const entry of stream) {
        reply.raw.write(`event: runtime\ndata: ${JSON.stringify(entry)}\n\n`);
      }

      reply.raw.end();
      return reply;
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.code(404).send({
          error: error instanceof Error ? error.message : 'Chat session not found.'
        });
      }
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        await store.handleMessage(socket, message);
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: 'turn.error',
            error: error instanceof Error ? error.message : 'Unexpected API error.'
          })
        );
      }
    });
  });

  return app;
}
