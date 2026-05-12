import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const rootDir = path.join(__dirname, '..');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendFile(res, filepath) {
  const stream = fs.createReadStream(filepath);
  stream.on('error', () => {
    res.writeHead(404);
    res.end('Not found');
  });
  const ext = path.extname(filepath);
  const type = ext === '.md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
  res.writeHead(200, { 'Content-Type': type });
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');

  if (req.method === 'GET' && url.pathname === '/') {
    return sendFile(res, path.join(publicDir, 'index.html'));
  }

  if (req.method === 'GET' && url.pathname === '/overall-poc.spec.md') {
    return sendFile(res, path.join(rootDir, 'overall-poc.spec.md'));
  }

  if (req.method === 'GET' && url.pathname === '/session-01.plan.md') {
    return sendFile(res, path.join(rootDir, 'session-01.plan.md'));
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      name: 'palpa-voice-poc',
      status: 'session-01',
      focus: 'voice input to mock agent loop with visible output and TTS'
    });
  }

  res.writeHead(404);
  res.end('Not found');
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Palpa Voice POC running at http://${host}:${port}`);
});
