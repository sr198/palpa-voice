import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config as defaultConfig } from './config.js';
import { SessionStore } from './session-store.js';
import { codexRoutingConfigured, discoverCodexWorkspace, gatewayAgent, listAgents } from './agents.js';

export async function buildApp({ config = defaultConfig, random = Math.random } = {}) {
  const app = Fastify();
  const store = new SessionStore({ config, random });

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
