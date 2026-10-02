import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createService } from '../src/server/tools.mjs';
import { Store, newRecord, sourceHash } from '../src/server/store.mjs';
import { taskHash } from '../src/server/board-model.mjs';
import { MockCodex } from './fixtures/mock-codex.mjs';

async function setup() { await fs.mkdir('_work', { recursive: true }); const dataDir = await fs.mkdtemp(path.resolve('_work/board-test-')); const runtime = new MockCodex(); const service = createService({ dataDir, runtime }); const { project } = await service.call('steward_project_create', { title: '测试项目', goal: '验证真实推进闭环' }); return { service, runtime, project, dataDir }; }
async function ready(service, projectId, title = '测试小卡') { const { task } = await service.call('steward_task_create', { projectId, title, description: '制作可验收的结果' }); await service.call('steward_task_move', { id: task.id, phase: 'ready' }); await service.call('steward_task_update', { id: task.id, title, description: task.description, criteria: ['结果可以打开并验证'] }); return task.id; }
const reportFor = (task) => ({ summary: '结果已交付', checks: task.criteria.map((criterion) => ({ criterion, passed: true, evidence: '真实验证结果在所关联主聊天中' })), materials: [{ title: '项目决定', content: '保存一条可复用结论' }] });
async function deliver(service, runtime, task) { await service.call('steward_submit_delivery', { id: task.id, runId: task.runId, hash: task.confirmedHash, report: reportFor(task) }); runtime.complete(task.mainChatId); await service.board.flush(); }

test('1.0 数据迁移保留原记录、待办状态和旧版本备份', async () => {
  await fs.mkdir('_work', { recursive: true }); const dir = await fs.mkdtemp(path.resolve('_work/migration-')); const record = newRecord({ type: 'todo', content: '原待办', title: '原待办' }); record.completed = true; delete record.projectId; delete record.sourceChatId; delete record.hidden;
  const raw = { version: 1, records: [record], insights: [], jobs: [], settings: { mode: 'codex', apiBaseUrl: 'https://api.openai.com/v1', model: '' } }; const original = JSON.stringify(raw); await fs.writeFile(path.join(dir, 'steward.json'), original);
  const store = new Store(dir); const migrated = await store.read(); assert.equal(migrated.version, 2); assert.equal(migrated.tasks[0].id, record.id); assert.equal(migrated.tasks[0].phase, 'done'); assert.equal(migrated.records[0].content, '原待办'); assert.equal(await fs.readFile(store.file, 'utf8'), original);
  await store.mutate((s) => { s.projects[0].goal = '保留历史'; }); assert.equal(await fs.readFile(store.file + '.bak', 'utf8'), original);
  await store.mutate((s) => { s.projects[0].goal = '继续整理'; }); const backup = (await fs.readdir(dir)).find((name) => name.startsWith('steward.v1.')); assert.equal(await fs.readFile(path.join(dir, backup), 'utf8'), original);
});

test('验收确认与原子启动阻止重复执行，后续继续同一个主聊天', async () => {
  const { service, runtime, project } = await setup(); const id = await ready(service, project.id);
  await assert.rejects(service.call('steward_task_start', { id }), /确认/); await service.call('steward_task_confirm', { id });
  const results = await Promise.allSettled([service.call('steward_task_start', { id }), service.call('steward_task_start', { id })]); assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(runtime.starts.length, 1);
  let state = await service.current(); const chat = state.tasks[0].mainChatId; assert.equal(state.projects[0].phase, 'active'); assert.equal(state.tasks[0].phase, 'active');
  runtime.complete(chat); await service.board.flush(); state = await service.current(); assert.equal(state.tasks[0].phase, 'active'); assert.equal(state.tasks[0].execution, 'waiting');
  await service.call('steward_chat_send', { taskId: id, message: '继续完善' }); assert.equal(runtime.starts[1].chatId, chat); assert.equal(runtime.threads.size, 1);
});

test('完整交付证据与执行结束共同送验；用户验收后项目自动待验收', async () => {
  const { service, runtime, project } = await setup(); const id = await ready(service, project.id); await service.call('steward_task_confirm', { id }); let { task } = await service.call('steward_task_start', { id });
  const invalid = reportFor(task); invalid.checks[0].passed = false; await assert.rejects(service.call('steward_submit_delivery', { id, runId: task.runId, hash: task.confirmedHash, report: invalid }), /证据/);
  await service.call('steward_submit_delivery', { id, runId: task.runId, hash: task.confirmedHash, report: reportFor(task) }); assert.equal((await service.current()).tasks[0].phase, 'active');
  runtime.complete(task.mainChatId); await service.board.flush(); let state = await service.current(); assert.equal(state.tasks[0].phase, 'review'); assert.equal(state.projects[0].phase, 'active'); assert.equal(state.records[0].sourceChatId, task.mainChatId);
  await service.call('steward_task_move', { id, phase: 'done' }); state = await service.current(); assert.equal(state.projects[0].phase, 'review'); await service.call('steward_project_move', { id: project.id, phase: 'done' }); assert.equal((await service.current()).projects[0].phase, 'done');
});

test('大卡回退实际停止全部执行，将所有阶段小卡退回待启动并拒绝过期结果', async () => {
  const { service, runtime, project } = await setup(); const a = await ready(service, project.id, '正在运行'); const b = await ready(service, project.id, '已完成'); const { task: idea } = await service.call('steward_task_create', { projectId: project.id, title: '灵感' });
  await service.call('steward_task_confirm', { id: a }); await service.call('steward_task_confirm', { id: b }); const aRun = (await service.call('steward_task_start', { id: a })).task; const bRun = (await service.call('steward_task_start', { id: b })).task; await deliver(service, runtime, bRun); await service.call('steward_task_move', { id: b, phase: 'done' });
  await service.call('steward_project_move', { id: project.id, phase: 'ready' }); const state = await service.current(); assert.equal(state.tasks.length, 3); assert.ok(state.tasks.every((t) => t.phase === 'ready' && t.execution === 'idle')); assert.equal(runtime.interrupts.length, 1); assert.equal(state.tasks.find((t) => t.id === a).mainChatId, aRun.mainChatId); assert.equal(state.records.length, 1);
  await assert.rejects(service.call('steward_submit_delivery', { id: a, runId: aRun.runId, hash: aRun.confirmedHash, report: reportFor(aRun) }), /过期/);
});

test('部分停止失败不伪造整个项目已回退', async () => {
  const { service, runtime, project } = await setup(); const a = await ready(service, project.id, '甲'); const b = await ready(service, project.id, '乙'); await service.call('steward_task_confirm', { id: a }); await service.call('steward_task_confirm', { id: b }); await service.call('steward_task_start', { id: a }); const { task } = await service.call('steward_task_start', { id: b }); runtime.failStops.add(task.mainChatId);
  await assert.rejects(service.call('steward_project_move', { id: project.id, phase: 'ready' }), /停止确认/); const state = await service.current(); assert.equal(state.projects[0].phase, 'active'); assert.ok(state.tasks.every((t) => t.phase === 'active')); assert.equal(state.tasks.find((t) => t.id === b).execution, 'failed');
});

test('报告等待回复仍在实际执行时，回退必须中断且不能偷偷改标准', async () => {
  const { service, runtime, project } = await setup(); const id = await ready(service, project.id); await service.call('steward_task_confirm', { id }); const { task } = await service.call('steward_task_start', { id });
  await service.call('steward_task_report', { id, runId: task.runId, state: 'waiting', progress: '等待用户补充' }); await assert.rejects(service.call('steward_task_update', { id, title: task.title, description: task.description, criteria: ['新标准'] }), /停止/);
  await service.call('steward_task_move', { id, phase: 'ready' }); assert.equal(runtime.interrupts.length, 1); await service.call('steward_task_update', { id, title: task.title, description: task.description, criteria: ['新标准'] }); assert.equal((await service.current()).tasks[0].confirmedHash, null); await assert.rejects(service.call('steward_task_start', { id }), /确认/);
});

test('AI 拆分经用户挑选后才创建小卡，重复应用和旧目标拒绝写回', async () => {
  const { service, runtime, project } = await setup(); let { proposal } = await service.call('steward_propose', { projectId: project.id, type: 'split' }); runtime.complete(proposal.chatId, 'completed', { tasks: [{ title: '建议一', description: '完成一', criteria: ['证据一'] }, { title: '建议二', description: '完成二', criteria: ['证据二'] }] }); await service.board.flush(); assert.equal((await service.current()).tasks.length, 0);
  await service.call('steward_apply_proposal', { id: proposal.id, tasks: [{ title: '用户改名', description: '修改后的范围', criteria: ['修改后的标准'] }] }); let state = await service.current(); assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].title, '用户改名'); assert.equal(state.tasks[0].confirmedHash, null); await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, tasks: [{ title: '重复应用', description: '', criteria: [] }] }), /已应用/);
  proposal = (await service.call('steward_propose', { projectId: project.id, type: 'split' })).proposal; runtime.complete(proposal.chatId, 'completed', { tasks: [{ title: '旧目标', description: '旧范围', criteria: ['旧标准'] }] }); await service.board.flush(); await service.call('steward_project_update', { id: project.id, title: project.title, goal: '已经修改目标' }); await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, tasks: [{ title: '旧目标', description: '', criteria: [] }] }), /已修改/);
});

test('历史聊天仅分析所选范围，模型编造聊天不能变成关联', async () => {
  const { service, runtime, project } = await setup(); runtime.threads.set('chosen-chat', { id: 'chosen-chat', name: '用户所选', turns: [] }); const { proposal } = await service.call('steward_propose', { projectId: project.id, type: 'history', chatIds: ['chosen-chat'] }); assert.deepEqual(runtime.historyReads, ['chosen-chat']); runtime.complete(proposal.chatId, 'completed', { assignments: [{ chatId: 'unselected-chat', taskId: null, title: '假归属', description: '' }] }); await service.board.flush(); assert.equal((await service.current()).proposals[0].status, 'error'); assert.equal((await service.current()).tasks.length, 0);
});

test('项目问答的资料发生变化后拒绝保存旧结论，移除资料保留历史来源', async () => {
  const { service, runtime, project } = await setup(); const { record } = await service.call('steward_create', { type: 'material', projectId: project.id, title: '原资料', content: '原结论' }); const { proposal } = await service.call('steward_propose', { projectId: project.id, type: 'question', question: '有什么决定？' }); runtime.complete(proposal.chatId, 'completed', { answer: '原结论[1]', sources: [{ recordId: record.id, note: '来源' }], actions: [] }); await service.board.flush(); await service.call('steward_material_hide', { id: record.id, projectId: project.id }); await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id }), /已修改/); const state = await service.current(); assert.equal(state.records[0].content, '原结论'); assert.equal(state.records[0].hidden, true);
});

test('标准修改撤回旧验收，回退后的旧成果不能再次结项', async () => {
  const { service, runtime, project } = await setup(); const id = await ready(service, project.id);
  await service.call('steward_task_confirm', { id }); const { task } = await service.call('steward_task_start', { id }); await deliver(service, runtime, task);
  await service.call('steward_task_update', { id, title: task.title, description: task.description, criteria: ['修订后的证据'] });
  let state = await service.current(); assert.equal(state.tasks[0].phase, 'ready'); assert.equal(state.tasks[0].deliveryHash, null); assert.ok(state.tasks[0].delivery); assert.equal(state.records.length, 1);
  await service.call('steward_task_confirm', { id }); const rerun = (await service.call('steward_task_start', { id })).task; await deliver(service, runtime, rerun); await service.call('steward_task_move', { id, phase: 'done' });
  await assert.rejects(service.call('steward_task_update', { id, title: task.title, description: '另一个目标', criteria: ['修订后的证据'] }), /先回退/);
  await service.call('steward_task_move', { id, phase: 'review' }); await assert.rejects(service.call('steward_task_move', { id, phase: 'done' }), /对应交付/);
  state = await service.current(); assert.equal(state.tasks[0].mainChatId, task.mainChatId); assert.equal(state.projects[0].phase, 'active');
});

test('项目重开保留历史小卡，追加任务不触发全量回退', async () => {
  const { service, runtime, project } = await setup(); const id = await ready(service, project.id); await service.call('steward_task_confirm', { id }); const { task } = await service.call('steward_task_start', { id }); await deliver(service, runtime, task); await service.call('steward_task_move', { id, phase: 'done' }); await service.call('steward_project_move', { id: project.id, phase: 'done' });
  await assert.rejects(service.call('steward_task_create', { projectId: project.id, title: '新需求' }), /重新打开/);
  await service.call('steward_project_reopen', { id: project.id }); await service.call('steward_task_create', { projectId: project.id, title: '新需求' });
  const state = await service.current(); assert.equal(state.projects[0].phase, 'ready'); assert.equal(state.tasks.find((t) => t.id === id).phase, 'done'); assert.equal(state.tasks.find((t) => t.id === id).mainChatId, task.mainChatId); assert.equal(state.tasks[1].phase, 'idea'); assert.equal(runtime.interrupts.length, 0);
});

test('历史聊天建议可确认新项目或其他项目，始终只关联所选聊天', async () => {
  const { service, runtime, project } = await setup(); const other = (await service.call('steward_project_create', { title: '其他项目' })).project;
  for (const id of ['chosen-a', 'chosen-b']) runtime.threads.set(id, { id, name: id, turns: [] });
  const { proposal } = await service.call('steward_propose', { projectId: project.id, type: 'history', chatIds: ['chosen-a', 'chosen-b'] });
  const assignments = [{ chatId: 'chosen-a', projectId: null, projectTitle: '归纳的新项目', taskId: null, title: '归纳小卡', description: '历史目标' }, { chatId: 'chosen-b', projectId: other.id, projectTitle: '', taskId: null, title: '其他小卡', description: '另一个范围' }];
  runtime.complete(proposal.chatId, 'completed', { assignments }); await service.board.flush(); assert.equal((await service.current()).projects.length, 2);
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments: [{ ...assignments[0], chatId: 'unselected' }] }), /所选/);
  await service.call('steward_apply_proposal', { id: proposal.id, assignments }); const state = await service.current(); assert.equal(state.projects.length, 3); assert.equal(state.tasks.find((t) => t.mainChatId === 'chosen-a').projectId, state.projects.find((p) => p.title === '归纳的新项目').id); assert.equal(state.tasks.find((t) => t.mainChatId === 'chosen-b').projectId, other.id);
});

test('项目归档行动建议需用户确认，重复确认不重复建卡', async () => {
  const { service, project } = await setup(); const { record } = await service.call('steward_create', { type: 'material', projectId: project.id, title: '资料', content: '明确行动建议' });
  const analysis = { category: '决定', summary: '需要用户选择', keypoints: [], tags: [], priority: 'medium', relatedIds: [], actions: [{ title: '尝试实现', content: '先界定目标', priority: 'medium' }] };
  await service.call('steward_apply_archive', { id: record.id, hash: sourceHash(record), analysis }); let state = await service.current(); assert.equal(state.tasks.length, 0); assert.equal(state.records.length, 1);
  const args = { id: record.id, expectedUpdatedAt: state.records[0].updatedAt, indexes: [0] }; await service.call('steward_accept_actions', args); await service.call('steward_accept_actions', args);
  state = await service.current(); assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].sourceRecordId, record.id); assert.equal(state.tasks[0].phase, 'idea'); assert.equal(state.tasks[0].confirmedHash, null);
});

test('大卡回退等待停止时，其他窗口不能新增或启动遗漏的小卡', async () => {
  const { service, runtime, project } = await setup(); const a = await ready(service, project.id, '执行中'), b = await ready(service, project.id, '尚未执行');
  await service.call('steward_task_confirm', { id: a }); await service.call('steward_task_confirm', { id: b }); const { task } = await service.call('steward_task_start', { id: a });
  let entered, release; const reached = new Promise((r) => { entered = r; }), gate = new Promise((r) => { release = r; });
  runtime.interrupt = async () => { entered(); await gate; runtime.complete(task.mainChatId, 'interrupted'); };
  const rollback = service.call('steward_project_move', { id: project.id, phase: 'ready' }); await reached;
  await assert.rejects(service.call('steward_task_start', { id: b }), /正在停止/); await assert.rejects(service.call('steward_task_create', { projectId: project.id, title: '其他窗口新任务' }), /正在停止/);
  release(); await rollback; const state = await service.current(); assert.ok(state.tasks.every((t) => t.phase === 'ready')); assert.equal(state.projects[0].transitionId, null);
});

test('备份合并可重复恢复小卡，不恢复执行且拒绝主聊天冲突', async () => {
  const { service, project } = await setup(); await ready(service, project.id); const backup = (await service.call('steward_export')).data;
  const dataDir = await fs.mkdtemp(path.resolve('_work/import-board-')); const restored = createService({ dataDir, runtime: new MockCodex() });
  assert.equal((await restored.call('steward_import', { data: backup })).imported, 2); assert.equal((await restored.call('steward_import', { data: backup })).imported, 0);
  const state = await restored.current(); assert.equal(state.tasks[0].execution, 'idle'); assert.equal(state.tasks[0].runId, null);
  const invalid = structuredClone(backup); invalid.tasks[0].mainChatId = 'shared'; invalid.tasks.push({ ...invalid.tasks[0], id: 'another-card' });
  await assert.rejects(restored.call('steward_import', { data: invalid }), /同一主聊天/); assert.equal((await restored.current()).tasks.length, 1);
});
