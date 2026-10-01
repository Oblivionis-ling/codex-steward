import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHttpServer } from '../src/server/http.mjs';

await mkdir(path.resolve('_work'), { recursive: true });

test('打包 MCP 能初始化、注册左右入口、加载独立 UI 并保存记录', async (t) => {
  const dir = await mkdtemp(path.resolve('_work/mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/personal-steward/dist/mcp.mjs')], env: { ...process.env, STEWARD_DATA_DIR: dir }, stderr: 'pipe' });
  let errors = ''; transport.stderr?.on('data', (chunk) => { errors += chunk; });
  const client = new Client({ name: 'steward-qa', version: '1.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === 'steward_records'));
  assert.ok(tools.tools.some((tool) => tool.name === 'steward_apply_archive'));
  const open = tools.tools.find((tool) => tool.name === 'steward_open');
  assert.deepEqual(open._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
  assert.deepEqual(tools.tools.find((tool) => tool.name === 'steward_panel')._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
  assert.deepEqual(tools.tools.find((tool) => tool.name === 'steward_run_ai')._meta.ui.visibility, ['app']);
  const resource = await client.readResource({ uri: open._meta.ui.resourceUri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /个人管家/); assert.doesNotMatch(resource.contents[0].text, /src="\/src\/ui/);
  const created = await client.callTool({ name: 'steward_create', arguments: { type: 'todo', content: 'MCP 协议验收待办' } });
  assert.equal(created.isError, undefined); assert.equal(created.structuredContent.record.type, 'todo');
  const state = await client.callTool({ name: 'steward_state', arguments: {} });
  assert.equal(state.structuredContent.records.length, 1);
  assert.equal(errors, '');
});

test('HTTP 界面可用，拒绝跨域与 DNS 重绑定请求', async (t) => {
  const dir = await mkdtemp(path.resolve('_work/http-'));
  const server = createHttpServer({ dataDir: dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  const invalid = await fetch(`${base}/api/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify({ name: 'steward_create', args: { type: 'idea', content: '跨域不能写' } }) });
  assert.equal(invalid.status, 403);
  const reboundStatus = await new Promise((resolve, reject) => { const request = http.get(`${base}/health`, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(reboundStatus, 403);
  const result = await fetch(`${base}/api/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'steward_create', args: { type: 'idea', content: '中文 HTTP 记录' } }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).record.content, '中文 HTTP 记录');
});
