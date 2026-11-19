// Page — a single automation tab in the user's Chrome, driven through the jimeng-cli extension.
//
// The API mirrors the subset the jimeng commands need: goto / evaluate / cdp / insertText /
// setFileInput / screenshot / focus / close.
import fs from 'node:fs';
import path from 'node:path';
import { sendCommand } from './client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV_ERROR = /context was destroyed|Cannot find context|Inspected target navigated|Execution context/i;

function serializeArg(a) {
  return a === undefined ? 'undefined' : JSON.stringify(a);
}

export function buildExpression(fnOrCode, args = []) {
  if (typeof fnOrCode === 'function') {
    return `(async () => (${fnOrCode.toString()})(${args.map(serializeArg).join(', ')}))()`;
  }
  return String(fnOrCode);
}

export class Page {
  constructor(session) {
    this.sessionId = session.sessionId;
    this.tabId = session.tabId;
    this.windowId = session.windowId;
  }

  /**
   * Open a new automation tab.
   * windowMode: 'foreground' (own focused window — needed for uploads / @ popup, which stall in hidden
   * tabs) or 'background' (own unfocused window).
   */
  static async open({ url = 'about:blank', windowMode = 'foreground' } = {}) {
    const session = await sendCommand('session-open', { url, windowMode }, { timeoutMs: 60000 });
    return new Page(session);
  }

  async goto(url, { timeoutMs = 60000 } = {}) {
    await sendCommand('navigate', { sessionId: this.sessionId, url, timeoutMs }, { timeoutMs: timeoutMs + 5000 });
  }

  async evaluate(fnOrCode, ...args) {
    const expression = buildExpression(fnOrCode, args);
    try {
      return await sendCommand('exec', { sessionId: this.sessionId, expression });
    } catch (err) {
      if (!NAV_ERROR.test(String(err.message))) throw err;
      await sleep(1000);
      return sendCommand('exec', { sessionId: this.sessionId, expression });
    }
  }

  async cdp(method, params = {}) {
    return sendCommand('cdp', { sessionId: this.sessionId, method, params });
  }

  async insertText(text) {
    await this.cdp('Input.insertText', { text: String(text) });
  }

  /** Put local files into an <input type=file> (Chrome reads them from disk — no size limit). */
  async setFileInput(files, selector) {
    await this.cdp('DOM.enable', {}).catch(() => undefined);
    const doc = await this.cdp('DOM.getDocument', { depth: 0 });
    const q = await this.cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!q?.nodeId) throw new Error(`file input not found: ${selector}`);
    await this.cdp('DOM.setFileInputFiles', { files: files.map((f) => path.resolve(f)), nodeId: q.nodeId });
  }

  async screenshot({ path: file, format = 'png', fullPage = false } = {}) {
    const params = { format };
    if (fullPage) params.captureBeyondViewport = true;
    const r = await this.cdp('Page.captureScreenshot', params);
    const buf = Buffer.from(r.data, 'base64');
    if (file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, buf);
    }
    return r.data;
  }

  /** Bring the automation window + tab to the front (rAF-driven UI stalls in hidden tabs). */
  async focus() {
    return sendCommand('focus', { sessionId: this.sessionId });
  }

  async close() {
    await sendCommand('session-close', { sessionId: this.sessionId }, { timeoutMs: 15000 }).catch(() => undefined);
  }
}
