// jimeng whoami — 检查 Chrome 中的即梦登录状态（只读）
import { cli, Strategy } from '../registry.js';
import { AuthRequiredError } from '../errors.js';
import { DOMAIN, VIDEO_URL, sleep } from '../jimeng/utils.js';

export async function checkLogin(page) {
  await page.goto(VIDEO_URL);
  let state = { login: false };
  for (let i = 0; i < 20 && !state.login; i++) {
    if (i) await sleep(500);
    state = await page.evaluate(() => ({
      login: !!document.querySelector('#js-side-menu-entry-avatar-container'),
      url: location.href,
      title: document.title,
    })).catch(() => ({ login: false }));
  }
  return state;
}

cli({
  name: 'whoami',
  description: '检查 Chrome 中即梦是否已登录',
  example: 'jimeng whoami',
  strategy: Strategy.UI,
  browser: true,
  defaultWindowMode: 'background',
  args: [],
  columns: ['login', 'url'],
  func: async (page) => {
    const st = await checkLogin(page);
    if (!st.login) throw new AuthRequiredError(DOMAIN, '即梦未登录', '在同一个 Chrome 中打开 https://jimeng.jianying.com 登录后重试');
    return [{ login: true, url: st.url }];
  },
});
