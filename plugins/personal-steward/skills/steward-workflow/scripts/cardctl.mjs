import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const config = JSON.parse(await readFile(path.join(pluginRoot, '.mcp.json'), 'utf8')).mcpServers.steward;
const base = `http://127.0.0.1:${config.env.STEWARD_PORT || 43187}`;
const health = async () => { try { return await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch { return null; } };
let h = await health();
if (!h) {
  const serverPath = path.join(path.dirname(config.args[0]), 'http.mjs');
  const child = spawn(config.command, [serverPath], { windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, ...config.env, PORT: config.env.STEWARD_PORT }, cwd: path.dirname(serverPath) });
  child.unref(); child.on('error', () => {});
  for (let i=0; i<50 && !h; i++) { await new Promise((resolve) => setTimeout(resolve,100)); h=await health(); }
}
if (!h || h.name !== 'personal-steward' || h.version !== '0.3.0' || path.resolve(h.dataDir) !== path.resolve(config.env.STEWARD_DATA_DIR)) throw new Error('工作台未启动或版本/数据目录不匹配，请重新打开灵感工作台。');
const [operation,...args] = process.argv.slice(2);
let name, input;
if (operation === 'read') { name='steward_card_read'; input={id:args[0]}; }
else if (operation === 'bind') {
  if (!process.env.CODEX_THREAD_ID) throw new Error('无法获取当前聊天 ID；请在工作台关联，不要编造。');
  name='steward_card_record'; input={id:args[0],token:args[1],threadId:process.env.CODEX_THREAD_ID,kind:'binding'};
}
else if (operation === 'record') { name='steward_card_record'; input=JSON.parse(await readFile(path.resolve(args[0]),'utf8')); if (!input.threadId && process.env.CODEX_THREAD_ID) input.threadId=process.env.CODEX_THREAD_ID; }
else throw new Error('用法：cardctl read <id> | bind <id> <token> | record <JSON文件>');
const r = await fetch(`${base}/api/tools`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args:input}) });
const result = await r.json(); if (!r.ok) throw new Error(result.error || '卡片写回失败');
process.stdout.write(JSON.stringify(result,null,2)+'\n');
