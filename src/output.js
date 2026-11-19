// Result rendering: table (default for TTY), json, plain.

const CJK = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function width(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 2 : 1;
  return w;
}

function truncate(s, max) {
  if (width(s) <= max) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = CJK.test(ch) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/\s+/g, ' ');
}

export function renderTable(rows, columns) {
  if (!rows.length) return '(empty)';
  let cols = (columns || []).filter((c) => rows.some((r) => r[c] !== undefined && r[c] !== ''));
  if (!cols.length) cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const maxW = Math.max(12, Math.floor(((process.stdout.columns || 160) - cols.length * 3) / cols.length));
  const data = rows.map((r) => cols.map((c) => truncate(cell(r[c]), Math.min(maxW, 60))));
  const widths = cols.map((c, i) => Math.max(width(c), ...data.map((d) => width(d[i]))));
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));
  const line = (cells) => cells.map((s, i) => pad(s, widths[i])).join(' │ ');
  return [line(cols), widths.map((w) => '─'.repeat(w)).join('─┼─'), ...data.map(line)].join('\n');
}

export function renderPlain(rows) {
  return rows.map((r) => Object.entries(r).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${cell(v)}`).join('\n')).join('\n\n');
}

export function printResult(data, { format, columns }) {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: true, data }, null, 2)}\n`);
    return;
  }
  const rows = Array.isArray(data) ? data : [data];
  if (format === 'plain') process.stdout.write(`${renderPlain(rows)}\n`);
  else process.stdout.write(`${renderTable(rows, columns)}\n`);
}

export function printError(err, { format }) {
  const error = { code: err.code || 'ERROR', message: String(err.message || err), ...(err.hint ? { hint: err.hint } : {}) };
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: false, error }, null, 2)}\n`);
    return;
  }
  process.stderr.write(`错误: ${error.message}\n${error.hint ? `提示: ${error.hint}\n` : ''}`);
}
