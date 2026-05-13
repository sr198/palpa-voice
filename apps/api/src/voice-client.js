import WebSocket from 'ws';

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('API cannot reach voice service.')), { once: true });
  });
}

export async function createVoiceAsrClient(url, onMessage, onClose) {
  const socket = new WebSocket(url);
  socket.addEventListener('message', (event) => onMessage(JSON.parse(event.data)));
  socket.addEventListener('close', onClose);
  await waitForOpen(socket);

  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    }
  };
}

export async function synthesizeVoice(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Voice synthesis failed.');
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'audio/wav',
    voiceId: response.headers.get('x-voice-id') || payload.voice_id,
    provider: response.headers.get('x-provider') || 'unknown',
    durationMs: Number(response.headers.get('x-duration-ms') || '0')
  };
}
