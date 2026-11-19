const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: 'status' });
  $('st').className = `row ${s.connected ? 'on' : ''}`;
  $('txt').textContent = s.connected ? `已连接 127.0.0.1:${s.port}` : `未连接（127.0.0.1:${s.port}）`;
  if (document.activeElement !== $('port')) $('port').value = s.port;
  $('ver').textContent = `扩展版本 ${s.version} · 自动化会话 ${s.sessions}`;
}

$('save').onclick = async () => {
  const port = Number($('port').value);
  if (port > 0 && port < 65536) await chrome.storage.local.set({ port });
  setTimeout(refresh, 800);
};
$('re').onclick = async () => { await chrome.runtime.sendMessage({ type: 'reconnect' }); setTimeout(refresh, 800); };

refresh();
setInterval(refresh, 1500);
