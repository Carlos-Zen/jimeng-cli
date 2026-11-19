// jimeng-cli Browser Bridge — service worker.
//
// Connects to the local jimeng-cli daemon (ws://127.0.0.1:<port>/ext) and executes commands in
// automation tabs it creates itself, via chrome.debugger (CDP). Scope is deliberately narrow:
//   * only tabs opened by this extension (sessions) can be driven
//   * those tabs may only navigate to / run code on *.jianying.com (即梦) or about:blank
const DEFAULT_PORT = 19835;
const PROTOCOL = 1;
const ALLOWED_HOST = /(^|\.)jianying\.com$/i;
const VERSION = chrome.runtime.getManifest().version;

let ws = null;
let connecting = false;
let backoff = 1000;
let pingTimer = null;
const sessions = new Map(); // sessionId → { tabId, windowId, attached }

// ───────────────────────── session persistence (survives service-worker restarts) ─────────────────────────

async function saveSessions() {
  await chrome.storage.session.set({ sessions: [...sessions.entries()].map(([id, s]) => [id, { tabId: s.tabId, windowId: s.windowId }]) });
}
async function loadSessions() {
  const { sessions: saved = [] } = await chrome.storage.session.get('sessions');
  for (const [id, s] of saved) if (!sessions.has(id)) sessions.set(id, { ...s, attached: false });
}
const ready = loadSessions().catch(() => undefined);

// ───────────────────────── daemon connection ─────────────────────────

async function getPort() {
  const { port } = await chrome.storage.local.get('port');
  return Number(port) || DEFAULT_PORT;
}

async function setBadge(on) {
  try {
    await chrome.action.setBadgeText({ text: on ? '' : 'off' });
    await chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' });
  } catch { /* ignore */ }
}

async function connect() {
  if (connecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  connecting = true;
  try {
    const port = await getPort();
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ext`);
    ws = sock;
    sock.onopen = () => {
      backoff = 1000;
      sock.send(JSON.stringify({ type: 'hello', version: VERSION, protocol: PROTOCOL, userAgent: navigator.userAgent }));
      clearInterval(pingTimer);
      // Regular traffic keeps the MV3 service worker alive while connected.
      pingTimer = setInterval(() => { try { sock.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ } }, 20000);
      setBadge(true);
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'command') handleCommand(sock, msg);
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      clearInterval(pingTimer);
      setBadge(false);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };
    sock.onerror = () => { /* onclose follows */ };
  } finally {
    connecting = false;
  }
}

chrome.alarms.create('jimeng-cli-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'jimeng-cli-keepalive') connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.port) { try { ws?.close(); } catch { /* ignore */ } }
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'status') {
    getPort().then((port) => reply({ connected: ws?.readyState === WebSocket.OPEN, port, sessions: sessions.size, version: VERSION }));
    return true;
  }
  if (msg?.type === 'reconnect') { try { ws?.close(); } catch { /* ignore */ } connect(); reply({ ok: true }); }
  return false;
});
connect();

// ───────────────────────── helpers ─────────────────────────

function isAllowedUrl(url) {
  if (!url || url === 'about:blank') return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`会话不存在或标签页已关闭: ${sessionId}`);
  return s;
}

async function ensureAttached(s) {
  if (s.attached) return;
  try {
    await chrome.debugger.attach({ tabId: s.tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String(e.message))) throw e;
  }
  s.attached = true;
}

async function cdp(s, method, params = {}) {
  await ensureAttached(s);
  return chrome.debugger.sendCommand({ tabId: s.tabId }, method, params);
}

async function assertTabAllowed(s) {
  const tab = await chrome.tabs.get(s.tabId);
  const url = tab.pendingUrl || tab.url;
  if (!isAllowedUrl(url)) throw new Error(`为安全起见，扩展只操作即梦页面（当前: ${url}）`);
  return tab;
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let sawLoading = false;
    const done = () => { clearTimeout(timer); clearInterval(poll); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const poll = setInterval(async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === 'loading') sawLoading = true;
        else if (sawLoading && t.status === 'complete') done();
      } catch { done(); }
    }, 500);
    const timer = setTimeout(done, timeoutMs);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── commands ─────────────────────────

const handlers = {
  async 'session-open'({ url = 'about:blank', windowMode = 'foreground' }) {
    if (!isAllowedUrl(url)) throw new Error(`不允许打开: ${url}`);
    const win = await chrome.windows.create({ url, focused: windowMode !== 'background', type: 'normal', width: 1440, height: 960 });
    const tab = win.tabs[0];
    const sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const s = { tabId: tab.id, windowId: win.id, attached: false };
    sessions.set(sessionId, s);
    await saveSessions();
    if (url !== 'about:blank') await waitForLoad(tab.id, 60000);
    await ensureAttached(s);
    return { sessionId, tabId: tab.id, windowId: win.id };
  },

  async navigate({ sessionId, url, timeoutMs = 60000 }) {
    const s = getSession(sessionId);
    if (!isAllowedUrl(url)) throw new Error(`不允许打开: ${url}`);
    const loaded = waitForLoad(s.tabId, timeoutMs);
    await chrome.tabs.update(s.tabId, { url });
    await loaded;
    await sleep(500);
    return { url };
  },

  async exec({ sessionId, expression }) {
    const s = getSession(sessionId);
    await assertTabAllowed(s);
    const r = await cdp(s, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.exception?.value || d.text || 'evaluate failed');
    }
    return r.result?.value;
  },

  async cdp({ sessionId, method, params }) {
    const s = getSession(sessionId);
    if (!/^(Runtime|DOM|Input|Page|Network|Emulation)\./.test(method) || method === 'Page.navigate') {
      throw new Error(`不支持的 CDP 方法: ${method}`);
    }
    await assertTabAllowed(s);
    if (method === 'Page.bringToFront') await handlers.focus({ sessionId });
    return cdp(s, method, params || {});
  },

  async focus({ sessionId }) {
    const s = getSession(sessionId);
    const tab = await chrome.tabs.get(s.tabId);
    await chrome.tabs.update(s.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
    const visibility = async () => {
      try {
        const r = await cdp(s, 'Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
        return r.result?.value;
      } catch { return 'unknown'; }
    };
    await sleep(250);
    let vis = await visibility();
    if (vis === 'hidden') {
      // Covered by another app: OS focus-stealing prevention can ignore `focused`. Restoring a
      // minimised window always raises it to the top.
      await chrome.windows.update(tab.windowId, { state: 'minimized' });
      await sleep(250);
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: true, drawAttention: true });
      await sleep(500);
      vis = await visibility();
    }
    return { windowId: tab.windowId, tabId: s.tabId, visibility: vis };
  },

  async reload() {
    setTimeout(() => chrome.runtime.reload(), 200);
    return { reloading: true };
  },

  async 'session-close'({ sessionId }) {
    const s = sessions.get(sessionId);
    if (!s) return { closed: false };
    sessions.delete(sessionId);
    await saveSessions();
    try { await chrome.debugger.detach({ tabId: s.tabId }); } catch { /* ignore */ }
    try { await chrome.tabs.remove(s.tabId); } catch { /* ignore */ }
    return { closed: true };
  },

  async status() {
    return { version: VERSION, sessions: [...sessions.entries()].map(([id, s]) => ({ sessionId: id, tabId: s.tabId })) };
  },
};

async function handleCommand(sock, msg) {
  await ready;
  const reply = (body) => { try { sock.send(JSON.stringify({ type: 'result', id: msg.id, ...body })); } catch { /* ignore */ } };
  const fn = handlers[msg.action];
  if (!fn) { reply({ ok: false, error: { code: 'UNKNOWN_ACTION', message: `扩展不支持的命令: ${msg.action}（请更新扩展）` } }); return; }
  try {
    reply({ ok: true, data: await fn(msg.params || {}) });
  } catch (e) {
    reply({ ok: false, error: { code: 'EXTENSION_ERROR', message: String(e?.message || e) } });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, s] of sessions) if (s.tabId === tabId) sessions.delete(id);
  saveSessions().catch(() => undefined);
});
chrome.debugger.onDetach.addListener((src) => {
  for (const s of sessions.values()) if (s.tabId === src.tabId) s.attached = false;
});
