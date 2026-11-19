// jimeng extension — 安装/更新 jimeng-cli 浏览器扩展
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cli, Strategy } from '../registry.js';
import { ArgumentError } from '../errors.js';
import { EXTENSION_ID, HOME_DIR } from '../browser/constants.js';
import { daemonStatus, sendCommand } from '../browser/client.js';
import { revealPath } from '../lib/library.js';

export const BUNDLED_EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
/** Stable install location, so `npm update` never moves the folder Chrome loads from. */
export const INSTALLED_EXTENSION_DIR = path.join(HOME_DIR, 'extension');

const manifestVersion = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version; } catch { return null; }
};

export function bundledExtensionVersion() { return manifestVersion(BUNDLED_EXTENSION_DIR); }
export function installedExtensionVersion() { return manifestVersion(INSTALLED_EXTENSION_DIR); }

/** Copy the bundled extension to ~/.jimeng-cli/extension (returns true when files changed). */
export function syncExtension() {
  const want = bundledExtensionVersion();
  const have = installedExtensionVersion();
  const changed = have !== want || !fs.existsSync(path.join(INSTALLED_EXTENSION_DIR, 'background.js'));
  if (changed) {
    fs.rmSync(INSTALLED_EXTENSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(INSTALLED_EXTENSION_DIR, { recursive: true });
    fs.cpSync(BUNDLED_EXTENSION_DIR, INSTALLED_EXTENSION_DIR, { recursive: true });
  }
  return changed;
}

function findChrome() {
  const env = process.env;
  const candidates = process.platform === 'win32'
    ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function openExtensionsPage() {
  const chrome = findChrome();
  if (!chrome) return false;
  const child = spawn(chrome, ['chrome://extensions/'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return true;
}

const ACTIONS = ['install', 'path', 'status'];

cli({
  name: 'extension',
  description: '浏览器扩展 — install: 复制扩展到固定目录并打开 Chrome 扩展页（默认） / path: 输出扩展目录 / status: 连接状态',
  example: 'jimeng extension',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'action', type: 'string', positional: true, default: 'install', help: ACTIONS.join(' | ') },
    { name: 'open', type: 'boolean', default: true, help: 'install 时打开 chrome://extensions 与扩展目录' },
  ],
  columns: ['action', 'status', 'path', 'version', 'next'],
  func: async (kwargs) => {
    const action = String(kwargs.action || 'install').toLowerCase();
    if (!ACTIONS.includes(action)) throw new ArgumentError(`未知操作 ${action}`, `可用: ${ACTIONS.join(' / ')}`);
    if (action === 'path') {
      syncExtension();
      return [{ action, path: INSTALLED_EXTENSION_DIR, version: installedExtensionVersion(), extension_id: EXTENSION_ID }];
    }
    if (action === 'status') {
      const s = await daemonStatus();
      return [{
        action,
        status: s?.extension?.connected ? 'connected' : s ? 'daemon running, extension not connected' : 'daemon not running',
        version: s?.extension?.extensionVersion || '',
        bundled_version: bundledExtensionVersion(),
        path: INSTALLED_EXTENSION_DIR,
        extension_id: EXTENSION_ID,
      }];
    }
    const changed = syncExtension();
    // Already installed and connected: reload it in place so Chrome picks up the new files.
    const live = await daemonStatus();
    if (live?.extension?.connected) {
      let reloaded = false;
      if (changed) {
        try {
          await sendCommand('reload', {}, { timeoutMs: 5000 });
          reloaded = true;
        } catch { /* older extension without `reload`: user clicks 重新加载 once */ }
      }
      return [{
        action,
        status: changed ? (reloaded ? 'updated & reloaded' : 'files updated — 请在 chrome://extensions 点击 jimeng-cli 的「重新加载」') : 'up to date',
        path: INSTALLED_EXTENSION_DIR,
        version: installedExtensionVersion(),
        extension_id: EXTENSION_ID,
      }];
    }
    let opened = false;
    if (kwargs.open) {
      opened = openExtensionsPage();
      revealPath(path.join(INSTALLED_EXTENSION_DIR, 'manifest.json'));
    }
    const steps = [
      '1. 在 Chrome 打开 chrome://extensions ，打开右上角「开发者模式」',
      `2. 点击「加载已解压的扩展程序」，选择目录: ${INSTALLED_EXTENSION_DIR}`,
      `   （已安装过则在该扩展卡片上点「重新加载」${changed ? '，本次扩展文件已更新' : ''}）`,
      '3. 运行 jimeng doctor 确认已连接',
    ];
    if (!kwargs.open || process.stdout.isTTY) process.stderr.write(`${steps.join('\n')}\n\n`);
    return [{
      action,
      status: changed ? 'files updated' : 'up to date',
      path: INSTALLED_EXTENSION_DIR,
      version: installedExtensionVersion(),
      extension_id: EXTENSION_ID,
      chrome_opened: opened,
      next: 'chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择上面的目录',
    }];
  },
});
