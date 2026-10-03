import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WORKFLOW_VERSION } from '../shared/workflow.js';

export function brokerClient() {
  const port = Number(process.env.STEWARD_PORT || 43187);
  const base = `http://127.0.0.1:${port}`;
  const dataDir = path.resolve(process.env.STEWARD_DATA_DIR || 'data');
  let startup;
  async function health() { try { const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
  async function ensure() {
    const alive = await health();
    if (alive) { if (alive.version !== WORKFLOW_VERSION || path.resolve(alive.dataDir) !== dataDir) throw new Error('本机服务的版本或数据目录不一致，请关闭旧预览服务后重试。'); return; }
    if (!startup) startup = (async () => {
      const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'http.mjs');
      const child = spawn(process.execPath, [serverPath], { windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port) }, cwd: path.dirname(serverPath) });
      child.on('error', () => {}); child.unref();
      for (let i = 0; i < 60; i++) { const result = await health(); if (result) { if (result.version !== WORKFLOW_VERSION || path.resolve(result.dataDir) !== dataDir) throw new Error('本机端口已由另一数据目录使用。'); return; } await new Promise((resolve) => setTimeout(resolve, 100)); }
      throw new Error('本机任务服务未能启动，请检查端口与 Node.js。');
    })().finally(() => { startup = null; });
    await startup;
  }
  return { async call(name, args = {}) { await ensure(); const response = await fetch(`${base}/api/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '本机任务调用失败。'); return result; } };
}
