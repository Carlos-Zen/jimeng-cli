// CLI side of the daemon protocol: start the daemon on demand, wait for the extension, send commands.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_HEADER, DAEMON_HOST, DAEMON_PORT, HOME_DIR } from './constants.js';
import { VERSION } from '../version.js';
import { BrowserConnectError, CommandExecutionError } from '../errors.js';

const BASE = `http://${DAEMON_HOST}:${DAEMON_PORT}`;
const DAEMON_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'daemon.js');
export const DAEMON_LOG = path.join(HOME_DIR, 'daemon.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, pathname, body, timeoutMs = 5000) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { [CLI_HEADER]: '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
}

/** Returns the daemon /status payload, or null if nothing (or something else) is listening. */
export async function daemonStatus() {
  try {
    const s = await request('GET', '/status', undefined, 1500);
    return s?.app === 'jimeng-cli-daemon' ? s : null;
  } catch {
    return null;
  }
}

export async function stopDaemon() {
  const s = await daemonStatus();
  if (!s) return false;
  await request('POST', '/shutdown').catch(() => undefined);
  for (let i = 0; i < 20 && (await daemonStatus()); i++) await sleep(150);
  return true;
}

function spawnDaemon() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const out = fs.openSync(DAEMON_LOG, 'a');
  const child = spawn(process.execPath, [DAEMON_SCRIPT], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  fs.closeSync(out);
  return child;
}

/** Make sure a daemon of *this* version is running. */
export async function ensureDaemon() {
  let s = await daemonStatus();
  if (s && s.version !== VERSION) {
    await stopDaemon();
    s = null;
  }
  if (s) return s;
  const child = spawnDaemon();
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    s = await daemonStatus();
    if (s) return s;
    if (child.exitCode != null) break;
  }
  throw new BrowserConnectError(
    `无法启动 jimeng-cli 守护进程（端口 ${DAEMON_PORT}）`,
    `查看日志 ${DAEMON_LOG}；端口被占用时可设置环境变量 JIMENG_DAEMON_PORT（扩展需同步修改，见 README）`,
  );
}

/** Start the daemon if needed and wait until the browser extension is connected. */
export async function ensureExtension({ timeoutMs = 30000, quiet = false } = {}) {
  let s = await ensureDaemon();
  if (s.extension?.connected) return s;
  if (!quiet) process.stderr.write('等待 Chrome 中的 jimeng-cli 扩展连接…\n');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(500);
    s = await daemonStatus();
    if (s?.extension?.connected) return s;
  }
  throw new BrowserConnectError(
    'Chrome 扩展未连接',
    '请确认 Chrome 已打开并已安装 jimeng-cli 扩展（运行 `jimeng extension` 查看安装方法），然后重试；`jimeng doctor` 可检查状态',
  );
}

/** Send one command to the extension; returns `data` or throws. */
export async function sendCommand(action, params = {}, { timeoutMs = 5 * 60 * 1000 } = {}) {
  let res;
  try {
    res = await request('POST', '/command', { action, params, timeoutMs }, timeoutMs + 10000);
  } catch (e) {
    throw new BrowserConnectError(`与 jimeng-cli 守护进程通信失败: ${e.message || e}`, '运行 `jimeng doctor` 检查状态');
  }
  if (res?.ok) return res.data;
  const err = res?.error || {};
  if (err.code === 'EXTENSION_DISCONNECTED') throw new BrowserConnectError(err.message, '确认 Chrome 正在运行且 jimeng-cli 扩展已启用');
  const e = new CommandExecutionError(err.message || `浏览器命令 ${action} 失败`, err.hint);
  e.browserCode = err.code;
  throw e;
}
