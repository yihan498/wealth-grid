/**
 * 飞书同步桥接服务
 * 用 lark-cli 已登录的身份读取飞书多维表格，供浏览器端调用
 *
 * 用法：node feishu-bridge.mjs
 * 然后在网页中点击「飞书同步」按钮即可
 */

import { createServer } from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
const PORT      = 9877;
const APP_TOKEN = 'UjXnbSTfkaUMTxsJqaScdHKFnl9';
const TABLE_ID  = 'tbl8V8TX2kOILaql';

async function fetchAllRecords() {
  const all = [];
  let pageToken = '';
  do {
    // 把分页参数拼进 URL，避免 --params JSON 在子进程里的引号问题
    let path = `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=100`;
    if (pageToken) path += `&page_token=${encodeURIComponent(pageToken)}`;
    const { stdout } = await exec('lark-cli', ['api', 'GET', path]);
    const data = JSON.parse(stdout);
    if (data.code !== 0) throw new Error('飞书 API 错误：' + (data.msg || data.code));
    all.push(...(data.data?.items || []));
    pageToken = data.data?.has_more ? data.data.page_token : '';
  } while (pageToken);
  return all;
}

const server = createServer(async (req, res) => {
  // CORS — 允许本地 wealth-grid 页面调用
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.url !== '/sync')      { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }

  try {
    const records = await fetchAllRecords();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, records }));
    console.log(`[${new Date().toLocaleTimeString()}] 同步完成，返回 ${records.length} 条记录`);
  } catch (err) {
    console.error('[Error]', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  飞书同步桥接服务已启动');
  console.log(`  地址：http://localhost:${PORT}/sync`);
  console.log('');
  console.log('  保持此窗口开着，在浏览器中点击「飞书同步」即可自动拉取数据');
  console.log('  Ctrl+C 退出');
  console.log('');
});
