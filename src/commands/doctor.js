// jimeng doctor — 一键检查：守护进程 / 浏览器扩展 / 即梦登录 / 素材库与桥接配置
import { cli, Strategy } from '../registry.js';
import { ensureExtension } from '../browser/client.js';
import { Page } from '../browser/page.js';
import { DAEMON_PORT, EXTENSION_ID } from '../browser/constants.js';
import { VERSION } from '../version.js';
import { configPath, readConfig, resolveLibraryDir } from '../lib/library.js';
import { INSTALLED_EXTENSION_DIR, bundledExtensionVersion, installedExtensionVersion } from './extension.js';
import { checkLogin } from './whoami.js';

cli({
  name: 'doctor',
  description: '检查运行环境：守护进程、浏览器扩展、即梦登录状态、配置',
  example: 'jimeng doctor',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'login', type: 'boolean', default: true, help: '检查即梦登录状态（会短暂打开一个后台窗口）' },
    { name: 'wait', type: 'int', default: 30, help: '等待扩展连接的秒数' },
  ],
  columns: ['check', 'ok', 'detail'],
  func: async (kwargs) => {
    const rows = [{ check: 'jimeng-cli', ok: true, detail: `v${VERSION} · node ${process.version}` }];
    let status = null;
    try {
      status = await ensureExtension({ timeoutMs: Number(kwargs.wait) * 1000 });
      rows.push({ check: 'daemon', ok: true, detail: `127.0.0.1:${DAEMON_PORT} (pid ${status.pid})` });
      const extV = status.extension.extensionVersion;
      const bundled = bundledExtensionVersion();
      rows.push({
        check: 'extension',
        ok: true,
        detail: `已连接 v${extV}${extV !== bundled ? `（新版本 v${bundled} 可用：运行 jimeng extension 后在 chrome://extensions 点「重新加载」）` : ''}`,
      });
    } catch (e) {
      rows.push({ check: 'extension', ok: false, detail: `${e.message}${e.hint ? ` — ${e.hint}` : ''}` });
      if (!installedExtensionVersion()) rows.push({ check: 'extension-files', ok: false, detail: '尚未安装扩展：运行 jimeng extension' });
      else rows.push({ check: 'extension-files', ok: true, detail: `${INSTALLED_EXTENSION_DIR} (id ${EXTENSION_ID})` });
    }
    if (status && kwargs.login) {
      let page;
      try {
        page = await Page.open({ windowMode: 'background' });
        const st = await checkLogin(page);
        rows.push({ check: 'jimeng-login', ok: st.login, detail: st.login ? '已登录' : '未登录：在同一个 Chrome 中打开 https://jimeng.jianying.com 登录' });
      } catch (e) {
        rows.push({ check: 'jimeng-login', ok: false, detail: String(e.message || e) });
      } finally {
        await page?.close();
      }
    }
    const cfg = readConfig();
    rows.push({ check: 'config', ok: true, detail: `${configPath()}${cfg.migratedFrom ? `（已从 ${cfg.migratedFrom} 迁移）` : ''}` });
    rows.push({ check: 'library', ok: true, detail: resolveLibraryDir() });
    return rows;
  },
});
