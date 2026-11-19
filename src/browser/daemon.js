#!/usr/bin/env node
// jimeng-cli browser daemon — tiny HTTP + WebSocket relay between the CLI and the jimeng-cli Chrome extension.
//
//   CLI  ──HTTP POST /command──▶  daemon  ──WebSocket──▶  extension (chrome.debugger / tabs / windows)
//   CLI  ◀──────── JSON ────────  daemon  ◀── result ───  extension
//
// Security:
//   * listens on 127.0.0.1 only
//   * WebSocket upgrade accepted only from the jimeng-cli extension origin (fixed extension ID)
//   * HTTP endpoints require the x-jimeng-cli header and reject any request carrying an Origin
//     header (blocks CSRF from web pages; browsers cannot add custom headers cross-origin
//     without a CORS preflight, which we never answer)
//
// Auto-started by the CLI on first browser command; stays resident until `jimeng daemon stop`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { CLI_HEADER, DAEMON_HOST, DAEMON_PORT, EXTENSION_ORIGIN, HOME_DIR, PROTOCOL_VERSION } from './constants.js';
import { VERSION } from '../version.js';

const MAX_BODY = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

let ext = null; // { ws, info, connectedAt }
let seq = 0;
const pending = new Map(); // id → { resolve, timer }

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extensionStatus() {
  return ext
    ? { connected: true, ...ext.info, connectedAt: ext.connectedAt }
    : { connected: false };
}

function dispatch(action, params, timeoutMs) {
  return new Promise((resolve) => {
    if (!ext) {
      resolve({ ok: false, error: { code: 'EXTENSION_DISCONNECTED', message: '浏览器扩展未连接' } });
      return;
    }
    const id = `c${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: { code: 'TIMEOUT', message: `扩展执行 ${action} 超时 (${Math.round(timeoutMs / 1000)}s)` } });
    }, timeoutMs);
    pending.set(id, { resolve, timer, action });
    try {
      ext.ws.send(JSON.stringify({ type: 'command', id, action, params }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, error: { code: 'EXTENSION_SEND', message: String(e.message || e) } });
    }
  });
}

const server = http.createServer(async (req, res) => {
  // Browsers always send Origin on cross-site fetch/XHR; legitimate CLI calls never do.
  if (req.headers.origin) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'origin not allowed' } });
  if (req.headers[CLI_HEADER] !== '1') return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'missing header' } });
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      return sendJson(res, 200, { ok: true, app: 'jimeng-cli-daemon', version: VERSION, protocol: PROTOCOL_VERSION, pid: process.pid, extension: extensionStatus() });
    }
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      sendJson(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100);
      return undefined;
    }
    if (req.method === 'POST' && url.pathname === '/command') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { action, params = {}, timeoutMs } = body;
      if (!action) return sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'action required' } });
      const result = await dispatch(action, params, Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS);
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: url.pathname } });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: { code: 'DAEMON_ERROR', message: String(e.message || e) } });
  }
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024 * 1024,
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ext' || req.headers.origin !== EXTENSION_ORIGIN) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  if (ext) {
    try { ext.ws.close(4000, 'replaced'); } catch { /* ignore */ }
  }
  const me = { ws, info: {}, connectedAt: new Date().toISOString() };
  ext = me;
  log('extension connected');
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'hello') {
      me.info = { extensionVersion: msg.version, protocol: msg.protocol, userAgent: msg.userAgent };
      ws.send(JSON.stringify({ type: 'hello', version: VERSION, protocol: PROTOCOL_VERSION }));
      return;
    }
    if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
    if (msg.type === 'result' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: msg.error || { code: 'EXTENSION_ERROR', message: 'unknown error' } });
    }
  });
  ws.on('close', () => {
    if (ext === me) {
      ext = null;
      log('extension disconnected');
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: { code: 'EXTENSION_DISCONNECTED', message: `执行 ${p.action} 时浏览器扩展断开` } });
        pending.delete(id);
      }
    }
  });
  ws.on('error', () => {});
});

server.on('error', (e) => {
  log('server error', e.code || e.message);
  process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
});

fs.mkdirSync(HOME_DIR, { recursive: true });
server.listen(DAEMON_PORT, DAEMON_HOST, () => {
  fs.writeFileSync(path.join(HOME_DIR, 'daemon.json'), JSON.stringify({ pid: process.pid, port: DAEMON_PORT, version: VERSION, startedAt: new Date().toISOString() }));
  log(`jimeng-cli daemon ${VERSION} listening on http://${DAEMON_HOST}:${DAEMON_PORT}`);
});
