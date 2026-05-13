import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config as defaultConfig } from './config.js';
import { SessionStore } from './session-store.js';

export async function buildApp({ config = defaultConfig, random = Math.random } = {}) {
  const app = Fastify();
  const store = new SessionStore({ config, random });

  await app.register(cors, {
    origin: config.webOrigin
  });
  await app.register(websocket);

  app.get('/health', async () => {
    let voice = { ok: false };

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
      voice
    };
  });

  app.get('/audio/:sessionId/:turnId', async (request, reply) => {
    const { sessionId, turnId } = request.params;
    const record = store.getAudio(sessionId, turnId);

    if (!record) {
      reply.code(404);
      return { error: 'Audio not found.' };
    }

    reply.header('Content-Type', record.contentType);
    return reply.send(record.buffer);
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
