// jimeng daemon — 管理连接浏览器扩展的本地守护进程
import { cli, Strategy } from '../registry.js';
import { ArgumentError } from '../errors.js';
import { DAEMON_LOG, daemonStatus, ensureDaemon, stopDaemon } from '../browser/client.js';
import { DAEMON_HOST, DAEMON_PORT } from '../browser/constants.js';

const ACTIONS = ['status', 'start', 'stop', 'restart'];

cli({
  name: 'daemon',
  description: '本地守护进程（CLI 与浏览器扩展之间的中转）— status / start / stop / restart',
  example: 'jimeng daemon status',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'action', type: 'string', positional: true, default: 'status', help: ACTIONS.join(' | ') }],
  columns: ['action', 'daemon', 'extension', 'url', 'log'],
  func: async (kwargs) => {
    const action = String(kwargs.action || 'status').toLowerCase();
    if (!ACTIONS.includes(action)) throw new ArgumentError(`未知操作 ${action}`, `可用: ${ACTIONS.join(' / ')}`);
    if (action === 'stop' || action === 'restart') await stopDaemon();
    if (action === 'start' || action === 'restart') await ensureDaemon();
    const s = await daemonStatus();
    return [{
      action,
      daemon: s ? `running (pid ${s.pid}, v${s.version})` : 'stopped',
      extension: s?.extension?.connected ? `connected (v${s.extension.extensionVersion || '?'})` : 'not connected',
      url: `http://${DAEMON_HOST}:${DAEMON_PORT}`,
      log: DAEMON_LOG,
    }];
  },
});
