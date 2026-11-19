import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';
import { getCommand } from '../src/registry.js';
import { buildExpression } from '../src/browser/page.js';
import { parsePrompt } from '../src/jimeng/utils.js';
import { TimeoutError } from '../src/errors.js';

test('video args: positional, booleans, ints, defaults', () => {
  const k = parseArgs(getCommand('video'), ['hello world', '--wait', 'false', '--dry-run', '--duration=5', '--no-save', '-f', 'json']);
  assert.equal(k.prompt, 'hello world');
  assert.equal(k.wait, false);
  assert.equal(k['dry-run'], true);
  assert.equal(k.duration, 5);
  assert.equal(k.save, false);
  assert.equal(k.format, 'json');
  assert.equal(k.mode, '全能参考');
  assert.equal(k['open-ui'], true);
});

test('bridge-style invocation parses (JSON --files, flag/value pairs)', () => {
  const k = parseArgs(getCommand('video'), ['p', '--mode', '首尾帧', '--wait', 'false', '--save', 'false', '--files', '["a.png","b.png"]', '--max-credits', '60']);
  assert.equal(k.files, '["a.png","b.png"]');
  assert.equal(k['max-credits'], 60);
  assert.equal(k.save, false);
});

test('aliases resolve', () => {
  assert.equal(getCommand('status').name, 'video-status');
  assert.equal(getCommand('list').name, 'video-list');
});

test('argument errors', () => {
  const cmd = getCommand('video');
  assert.throws(() => parseArgs(cmd, []), /缺少参数/);
  assert.throws(() => parseArgs(cmd, ['p', '--nope']), /未知参数/);
  assert.throws(() => parseArgs(cmd, ['p', '--duration', 'x']), /整数/);
  assert.throws(() => parseArgs(cmd, ['a', 'b']), /多余的参数/);
});

test('buildExpression serialises args incl. undefined', async () => {
  const expr = buildExpression((a, b, c) => [a, b, c], [1, undefined, { x: 'y' }]);
  // eslint-disable-next-line no-eval
  assert.deepEqual(await eval(expr), [1, undefined, { x: 'y' }]);
});

test('prompt @ references', () => {
  const files = [{ label: 'sun', kind: 'image', kindIndex: 1, name: 'sun.png' }];
  assert.deepEqual(parsePrompt('@图片1 升起', files).map((s) => s.type), ['mention', 'text']);
  assert.throws(() => parsePrompt('@视频1', files), /没有对应/);
  assert.deepEqual(parsePrompt('a @@ b @[主体] c', []).map((s) => s.type), ['text', 'mention', 'text']);
});

test('TimeoutError keeps (label, seconds, hint) signature', () => {
  const e = new TimeoutError('素材上传', 90, 'hint');
  assert.equal(e.message, '素材上传 超时（90s）');
  assert.equal(e.hint, 'hint');
  assert.equal(e.code, 'TIMEOUT');
});
