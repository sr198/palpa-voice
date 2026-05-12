import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionRuntime } from './runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const runtime = new SessionRuntime();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function serveFile(res, filepath) {
  const stream = fs.createReadStream(filepath);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  stream.pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(runtime.getProjection())}\n\n`;
  for (const res of clients) res.write(payload);
}

runtime.subscribe(() => broadcast());

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');

  if (req.method === 'GET' && url.pathname === '/') {
    return serveFile(res, path.join(publicDir, 'index.html'));
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    return json(res, 200, runtime.getProjection());
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(runtime.getProjection())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/messages') {
    try {
      const body = await readBody(req);
      if (!body.text || !String(body.text).trim()) return json(res, 400, { error: 'text is required' });
      const result = runtime.ingestMessage({ speaker: body.speaker || 'You', text: body.text });
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/codex/run') {
    try {
      const body = await readBody(req);
      const result = runtime.startCodexRun(body.task);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/patches/') && url.pathname.endsWith('/review')) {
    try {
      const id = url.pathname.split('/')[3];
      const body = await readBody(req);
      const result = runtime.reviewPatch(id, body.decision);
      if (!result) return json(res, 404, { error: 'patch not found' });
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Palpa POC running at http://${host}:${port}`);
});
