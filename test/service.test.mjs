import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Store, sourceHash, emptyState } from '../src/server/store.mjs';
import { createService } from '../src/server/tools.mjs';
import { callProvider } from '../src/server/ai.mjs';

await mkdir(path.resolve('_work'), { recursive: true });

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.resolve('_work/test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createService({ dataDir: dir, ...options });
}
const analysis = (title = '试用方法') => ({ category: '学习', summary: '记录了一个知识整理方法。', keypoints: ['保留原文'], tags: ['知识管理'], priority: 'high', relatedIds: [], actions: [{ title, content: '用一篇文章试用这个方法。', priority: 'medium' }] });
const waitUntil = async (fn) => { const end = Date.now() + 5000; while (Date.now() < end) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 15)); } throw new Error('timeout'); };

test('并发窗口保存不丢记录；数据文件不含 API Key', async (t) => {
  const service = await fixture(t);
  const other = createService({ dataDir: service.store.dataDir });
  await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? service : other).call('steward_create', { type: 'idea', content: `并发记录 ${index}` })));
  const state = await service.current();
  assert.equal(state.records.length, 24);
  assert.equal(new Set(state.records.map((record) => record.id)).size, 24);
  assert.equal((await readFile(service.store.file, 'utf8')).includes('apiKey'), false);
});
test('损坏 JSON 停止写入并保留原文件', async (t) => {
  const service = await fixture(t);
  await writeFile(service.store.file, '{坏文件', 'utf8');
  await assert.rejects(service.call('steward_create', { type: 'idea', content: '不能覆盖' }), /原文件/);
  assert.equal(await readFile(service.store.file, 'utf8'), '{坏文件');
});
test('归档提取待办保留来源、去重、校验内容变化', async (t) => {
  const service = await fixture(t);
  const { record } = await service.call('steward_create', { type: 'material', content: '学习一个新方法，下次用文章试试。' });
  await service.call('steward_apply_archive', { id: record.id, hash: sourceHash(record), analysis: analysis() });
  await service.call('steward_apply_archive', { id: record.id, hash: sourceHash(record), analysis: analysis() });
  const state = await service.current();
  assert.equal(state.records.length, 2);
  assert.equal(state.records[1].sourceId, record.id);
  await service.call('steward_update', { id: record.id, patch: { content: '用户修改了正文。' } });
  await assert.rejects(service.call('steward_apply_archive', { id: record.id, hash: sourceHash(record), analysis: analysis() }), /已修改/);
  assert.equal((await service.current()).records[0].archived, false);
});
test('新聊天链接保留中文、换行、符号和 workspace 路径', async (t) => {
  const service = await fixture(t);
  const { record } = await service.call('steward_create', { type: 'todo', content: '实现 A&B\n路径 C:\\资料\n#附注', priority: 'high' });
  const result = await service.call('steward_chat', { id: record.id });
  const url = new URL(result.url);
  assert.equal(url.protocol, 'codex:'); assert.equal(url.searchParams.get('path'), 'F:\\workspace');
  assert.match(url.searchParams.get('prompt'), /实现 A&B\n路径 C:\\资料\n#附注/);
  assert.match(url.searchParams.get('prompt'), new RegExp(record.id));
  assert.equal(url.searchParams.get('prompt'), result.prompt);
});
test('任务取消阻止后续写回；同类重叠任务拒绝重复开始', async (t) => {
  const service = await fixture(t);
  const { record } = await service.call('steward_create', { type: 'material', content: '整理素材' });
  const { job } = await service.call('steward_prepare_ai', { type: 'archive' });
  await assert.rejects(service.call('steward_prepare_ai', { type: 'archive' }), /正在处理/);
  await service.call('steward_cancel_job', { jobId: job.id });
  await assert.rejects(service.call('steward_apply_archive', { id: record.id, jobId: job.id, analysis: analysis() }), /已经结束/);
  assert.equal((await service.current()).records[0].archived, false);
});
test('问答保存校验来源，引用可追溯；不允许幻造 ID', async (t) => {
  const service = await fixture(t);
  const { record } = await service.call('steward_create', { type: 'idea', content: '作品集应该说明决策过程。' });
  const { job } = await service.call('steward_prepare_ai', { type: 'question', question: '作品集的想法？' });
  await assert.rejects(service.call('steward_save_insight', { jobId: job.id, result: { answer: '猜测', sources: [{ recordId: 'fake', note: '猜测' }], actions: [] } }), /范围/);
  await service.call('steward_save_insight', { jobId: job.id, result: { answer: '你记过说明决策过程。[1]', sources: [{ recordId: record.id, note: record.content }], actions: [] } });
  const state = await service.current();
  assert.equal(state.insights[0].sources[0].recordId, record.id);
  assert.equal(state.jobs[0].status, 'done');
});
test('北京时间日期筛选包含 UTC 前一日 16 点的记录', async (t) => {
  const service = await fixture(t);
  const { record } = await service.call('steward_create', { type: 'idea', content: '北京时间十月一日记录' });
  await service.store.mutate((state) => { state.records[0].createdAt = '2026-09-30T16:01:00.000Z'; });
  const result = await service.call('steward_records', { from: '2026-10-01', to: '2026-10-01' });
  assert.equal(result.records[0].id, record.id);
  assert.equal((await service.call('steward_records', { from: '2026-09-30', to: '2026-09-30' })).records.length, 0);
});
test('批量 API 归档逐条更新进度，不持久保存密钥', async (t) => {
  const calls = [];
  const service = await fixture(t, { providerOptions: { fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...analysis(), actions: [] }) } }] })); } } });
  await service.call('steward_create', { type: 'idea', content: '记录一' });
  await service.call('steward_create', { type: 'idea', content: '记录二' });
  const { job } = await service.call('steward_prepare_ai', { type: 'archive' });
  await service.call('steward_run_ai', { jobId: job.id, provider: { apiBaseUrl: 'https://provider.example/v1', apiKey: 'test-secret-sentinel', model: 'test-model' } });
  await waitUntil(async () => (await service.current()).jobs[0].status === 'done');
  const state = await service.current();
  assert.equal(state.jobs[0].done, 2); assert.equal(calls.length, 2); assert.equal(state.records.every((record) => record.archived), true);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret-sentinel');
  assert.equal((await readFile(service.store.file, 'utf8')).includes('test-secret-sentinel'), false);
});
test('模型错误或无效输出保留记录；禁止凭据重定向', async () => {
  const provider = { apiBaseUrl: 'https://provider.example/v1', apiKey: 'sentinel', model: 'model' };
  await assert.rejects(callProvider(provider, 'archive', [], {}, { fetch: async () => new Response('bad', { status: 401 }) }), /HTTP 401/);
  await assert.rejects(callProvider(provider, 'archive', [], {}, { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })) }), /未写入/);
  await assert.rejects(callProvider({ ...provider, apiBaseUrl: 'https://account:password@provider.example/v1' }, 'archive', []), /账户/);
  await assert.rejects(callProvider({ ...provider, apiBaseUrl: 'http://remote.example/v1' }, 'archive', []), /HTTPS/);
});
test('导入合并不覆盖，同 ID 冲突和失效关联保留原库', async (t) => {
  const service = await fixture(t);
  await service.call('steward_create', { type: 'idea', content: '保留的原记录' });
  const { data } = await service.call('steward_export');
  assert.equal((await service.call('steward_import', { data })).imported, 0);
  const conflict = structuredClone(data); conflict.records[0].content = '不同版本';
  await assert.rejects(service.call('steward_import', { data: conflict }), /未覆盖/);
  const invalid = structuredClone(data); invalid.records[0].id = 'new-id'; invalid.records[0].sourceId = 'missing';
  await assert.rejects(service.call('steward_import', { data: invalid }), /失效/);
  assert.deepEqual(await service.store.read(), data);
});
test('备份直接保存到本机，内容与导出接口一致', async (t) => {
  const service = await fixture(t);
  await service.call('steward_create', { type: 'todo', content: '本地备份验收' });
  const result = await service.call('steward_export');
  assert.equal(path.dirname(result.filePath), path.join(service.store.dataDir, 'backups'));
  assert.deepEqual(JSON.parse(await readFile(result.filePath, 'utf8')), result.data);
});
test('归档候选索引可关联已有记录，未知引用不会写入', async (t) => {
  const service = await fixture(t);
  const first = (await service.call('steward_create', { type: 'idea', content: '为摄影作品写创作手记' })).record;
  const second = (await service.call('steward_create', { type: 'material', content: '创作手记可说明拍摄意图' })).record;
  const { index } = await service.call('steward_records', { ids: [second.id], includeIndex: true });
  assert.equal(index[0].id, first.id);
  await service.call('steward_apply_archive', { id: second.id, hash: sourceHash(second), analysis: { ...analysis(), relatedIds: [first.id], actions: [] } });
  assert.deepEqual((await service.current()).records[0].relatedIds, [first.id]);
  await assert.rejects(service.call('steward_apply_archive', { id: second.id, hash: sourceHash(second), analysis: { ...analysis(), relatedIds: ['fake'] } }), /不存在/);
});
