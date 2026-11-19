// jimeng-cli entry: argument parsing, help, browser session lifecycle, output.
import { getCommand, listCommands } from './registry.js';
import { ArgumentError, EXIT_CODES } from './errors.js';
import { printError, printResult } from './output.js';
import { ensureExtension } from './browser/client.js';
import { Page } from './browser/page.js';
import { VERSION } from './version.js';

import './commands/video.js';
import './commands/image.js';
import './commands/video-status.js';
import './commands/video-list.js';
import './commands/whoami.js';
import './commands/library.js';
import './commands/bridge.js';
import './commands/doctor.js';
import './commands/extension.js';
import './commands/daemon.js';

const GLOBAL_OPTS = [
  { name: 'format', alias: 'f', type: 'string', help: '输出格式: table（默认）/ json / plain' },
  { name: 'keep-open', type: 'boolean', help: '浏览器命令结束后保留自动化窗口（调试用）' },
  { name: 'help', alias: 'h', type: 'boolean', help: '显示帮助' },
];

function parseBool(v, name) {
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  throw new ArgumentError(`--${name} 需要布尔值 true/false，收到 "${v}"`);
}

function coerce(spec, raw) {
  if (spec.type === 'int') {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new ArgumentError(`--${spec.name} 需要整数，收到 "${raw}"`);
    return n;
  }
  if (spec.type === 'boolean') return typeof raw === 'boolean' ? raw : parseBool(raw, spec.name);
  return String(raw);
}

export function parseArgs(cmd, argv) {
  const specs = [...(cmd?.args || []), ...GLOBAL_OPTS];
  const byName = new Map();
  for (const s of specs) {
    byName.set(s.name, s);
    if (s.alias) byName.set(s.alias, s);
  }
  const positionals = (cmd?.args || []).filter((a) => a.positional);
  const kwargs = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') { rest.push(...argv.slice(i + 1)); break; }
    let m = /^--([^=]+)(?:=(.*))?$/s.exec(tok) || /^-([a-zA-Z])$/.exec(tok);
    if (!m) { rest.push(tok); continue; }
    let name = m[1];
    let value = m[2];
    let spec = byName.get(name);
    if (!spec && name.startsWith('no-') && byName.get(name.slice(3))?.type === 'boolean') {
      spec = byName.get(name.slice(3));
      value = 'false';
    }
    if (!spec) throw new ArgumentError(`未知参数 ${tok}`, cmd ? `查看帮助: jimeng ${cmd.name} --help` : undefined);
    name = spec.name;
    if (value === undefined) {
      if (spec.type === 'boolean') {
        const next = argv[i + 1];
        if (next != null && /^(true|false|1|0|yes|no|on|off)$/i.test(next)) { value = next; i++; } else value = true;
      } else {
        if (i + 1 >= argv.length) throw new ArgumentError(`--${name} 需要一个值`);
        value = argv[++i];
      }
    }
    kwargs[name] = coerce(spec, value);
  }
  positionals.forEach((spec, idx) => {
    if (rest[idx] !== undefined) kwargs[spec.name] = coerce(spec, rest[idx]);
  });
  if (rest.length > positionals.length) {
    throw new ArgumentError(`多余的参数: ${rest.slice(positionals.length).join(' ')}`, '包含空格的提示词请用引号括起来');
  }
  for (const spec of cmd?.args || []) {
    if (kwargs[spec.name] === undefined && spec.default !== undefined) kwargs[spec.name] = spec.default;
    if (spec.required && (kwargs[spec.name] === undefined || kwargs[spec.name] === '')) {
      throw new ArgumentError(`缺少参数 <${spec.name}>`, `用法: jimeng ${cmd.name} ${usageLine(cmd)}`);
    }
  }
  return kwargs;
}

function usageLine(cmd) {
  const pos = (cmd.args || []).filter((a) => a.positional).map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
  return [...pos, '[选项]'].join(' ');
}

function optionLines(specs) {
  return specs.map((a) => {
    const flag = a.positional ? `<${a.name}>` : `--${a.name}${a.alias ? `, -${a.alias}` : ''}${a.type === 'boolean' ? '' : ` <${a.type === 'int' ? 'n' : 'v'}>`}`;
    const def = a.default !== undefined && a.default !== '' && !a.positional ? ` (默认 ${a.default})` : '';
    return `  ${flag.padEnd(26)} ${a.help || ''}${def}`;
  }).join('\n');
}

function commandHelp(cmd) {
  return [
    `jimeng ${cmd.name} ${usageLine(cmd)}`,
    '',
    cmd.description,
    ...(cmd.aliases?.length ? ['', `别名: ${cmd.aliases.join(', ')}`] : []),
    '',
    '参数:',
    optionLines(cmd.args || []),
    '',
    '通用选项:',
    optionLines(GLOBAL_OPTS),
    ...(cmd.example ? ['', `示例:\n  ${cmd.example}`] : []),
  ].join('\n');
}

function mainHelp() {
  const rows = listCommands().map((c) => `  ${c.name.padEnd(14)} ${c.description.split(/ — |：/)[0]}`);
  return [
    `jimeng-cli ${VERSION} — 用命令行驱动即梦AI（jimeng.jianying.com）网页：图片/视频生成、素材库、API 桥接`,
    '',
    '用法: jimeng <命令> [参数] [选项]',
    '',
    '命令:',
    ...rows,
    '',
    '首次使用: jimeng extension 安装浏览器扩展 → jimeng doctor 检查连接与登录',
    '查看某个命令: jimeng <命令> --help',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  let format = process.stdout.isTTY ? 'table' : 'json';
  const fIdx = argv.findIndex((a) => a === '-f' || a === '--format');
  if (fIdx >= 0 && argv[fIdx + 1]) format = argv[fIdx + 1];
  const fEq = argv.find((a) => a.startsWith('--format='));
  if (fEq) format = fEq.slice(9);

  const [name, ...rest] = argv;
  if (!name || name === '-h' || name === '--help' || name === 'help') {
    const sub = name === 'help' && rest[0] ? getCommand(rest[0]) : null;
    process.stdout.write(`${sub ? commandHelp(sub) : mainHelp()}\n`);
    return EXIT_CODES.OK;
  }
  if (name === '-v' || name === '--version' || name === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT_CODES.OK;
  }

  const cmd = getCommand(name);
  try {
    if (!cmd) throw new ArgumentError(`未知命令 ${name}`, '运行 jimeng --help 查看全部命令');
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(`${commandHelp(cmd)}\n`);
      return EXIT_CODES.OK;
    }
    const kwargs = parseArgs(cmd, rest);
    format = kwargs.format || format;
    if (!['table', 'json', 'plain'].includes(format)) throw new ArgumentError(`不支持的输出格式 ${format}`, 'table / json / plain');

    let data;
    if (cmd.browser) {
      await ensureExtension();
      const page = await Page.open({ windowMode: cmd.defaultWindowMode || 'foreground' });
      try {
        data = await cmd.func(page, kwargs);
      } finally {
        if (!kwargs['keep-open']) await page.close();
      }
    } else {
      data = await cmd.func(kwargs);
    }
    printResult(data ?? [], { format, columns: cmd.columns });
    return EXIT_CODES.OK;
  } catch (err) {
    printError(err, { format });
    if (process.env.JIMENG_DEBUG && err?.stack) process.stderr.write(`${err.stack}\n`);
    return err?.exitCode ?? EXIT_CODES.GENERIC;
  }
}
