import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createService } from '../src/server/tools.mjs';
import { Store, newRecord, sourceHash } from '../src/server/store.mjs';
import { taskHash } from '../src/server/board-model.mjs';
import { MockCodex } from './fixtures/mock-codex.mjs';

async function emptySetup() { await fs.mkdir('_work', { recursive: true }); const dataDir = await fs.mkdtemp(path.resolve('_work/board-test-')); const runtime = new MockCodex(); const service = createService({ dataDir, runtime }); return { service, runtime, dataDir }; }
async function setup() { const context = await emptySetup(); const { project } = await context.service.call('steward_project_create', { title: '测试项目', goal: '验证真实推进闭环' }); return { ...context, project }; }
async function ready(service, projectId, title = '测试小卡') { const { task } = await service.call('steward_task_create', { projectId, title, description: '制作可验收的结果' }); await service.call('steward_task_move', { id: task.id, phase: 'ready' }); await service.call('steward_task_update', { id: task.id, title, description: task.description, criteria: ['结果可以打开并验证'] }); return task.id; }
const reportFor = (task) => ({ summary: '结果已交付', checks: task.criteria.map((criterion) => ({ criterion, passed: true, evidence: '真实验证结果在所关联主聊天中' })), materials: [{ title: '项目决定', content: '保存一条可复用结论' }] });
async function deliver(service, runtime, task) { await service.call('steward_submit_delivery', { id: task.id, runId: task.runId, hash: task.confirmedHash, report: reportFor(task) }); runtime.complete(task.mainChatId); await service.board.flush(); }

test('拖动期间阶段变化时拒绝旧操作，不反向停止其他窗口刚启动的任务', async () => {
  const { service, runtime, project } = await setup(), id = await ready(service, project.id);
  await service.call('steward_task_confirm', { id }); const { task } = await service.call('steward_task_start', { id });
  await assert.rejects(service.call('steward_task_move', { id, phase: 'active', expectedPhase: 'ready' }), /阶段已变化/);
  await assert.rejects(service.call('steward_project_move', { id: project.id, phase: 'ready', expectedPhase: 'idea' }), /阶段已变化/);
  const current = (await service.current()).tasks.find((t) => t.id === id);
  assert.equal(current.phase, 'active'); assert.equal(current.runId, task.runId); assert.equal(runtime.interrupts.length, 0); assert.equal(runtime.starts.length, 1);
});

test('现有聊天默认排除本插件的整理回合，用户可以显式显示它们', async () => {
  const { service, runtime, project } = await setup(); let options;
  runtime.list = async (args) => { options = args; return { threads: [], nextCursor: null }; };
  const { proposal } = await service.call('steward_propose', { projectId: project.id, type: 'split' });
  await service.call('steward_chats'); assert.deepEqual(options.excludeIds, [proposal.chatId]);
  await service.call('steward_chats', { includeAuxiliary: true }); assert.deepEqual(options.excludeIds, []);
});

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

test('空看板直接整理所选聊天，确认前不建卡，同组聊天合为一个大卡', async () => {
  const { service, runtime, dataDir } = await emptySetup();
  await service.store.mutate((s) => { for (let i = 0; i < 7; i++) s.records.push(newRecord({ type: 'material', title: '不相关资料', content: '未选资料'.repeat(8000) })); });
  for (const id of ['selected-a', 'selected-b', 'not-selected']) runtime.threads.set(id, { id, name: id, turns: [] });
  const { proposal } = await service.call('steward_propose', { type: 'history', chatIds: ['selected-a', 'selected-b'] });
  assert.equal(proposal.projectId, null); assert.equal((await service.current()).projects.length, 0); assert.equal(runtime.starts[0].prompt.includes('不相关资料'), false); assert.deepEqual(proposal.sourceHashes, {});
  const assignments = ['selected-a', 'selected-b'].map((chatId, i) => ({ chatId, projectId: null, projectTitle: '同一长期项目', taskId: null, title: `子任务 ${i + 1}`, description: '从已选聊天提取的目标' }));
  runtime.complete(proposal.chatId, 'completed', { assignments }); await service.board.flush();
  const restored = createService({ dataDir, runtime: new MockCodex() }); const draftState = await restored.current();
  assert.equal(draftState.projects.length, 0); assert.equal(draftState.tasks.length, 0); assert.equal(draftState.proposals[0].status, 'ready');
  assert.equal(runtime.historyReads.includes('not-selected'), false); assert.equal(runtime.starts.length, 1); assert.equal(runtime.starts[0].context.kind, 'proposal');
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments: [{ ...assignments[0], chatId: 'not-selected' }] }), /所选/);
  assert.equal((await service.current()).projects.length, 0);
  const result = await service.call('steward_apply_proposal', { id: proposal.id, assignments }); const state = await service.current();
  assert.equal(state.projects.length, 1); assert.equal(state.tasks.length, 2); assert.deepEqual(result.projectIds, [state.projects[0].id]);
  assert.ok(state.tasks.every((t) => t.phase === 'idea' && t.confirmedHash === null && t.projectId === state.projects[0].id));
  assert.deepEqual(state.tasks.map((t) => t.mainChatId).sort(), ['selected-a', 'selected-b']);
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments }), /已应用/);
});

test('首页整理可归入已有小卡，尊重项目停止锁并保留原说明与主聊天', async () => {
  const { service, runtime, project } = await setup(); const taskId = await ready(service, project.id, '用户的小卡');
  for (const id of ['existing-main', 'selected-history']) runtime.threads.set(id, { id, name: id, turns: [] });
  await service.call('steward_chat_attach', { taskId, chatId: 'existing-main', main: true }); await service.call('steward_task_confirm', { id: taskId });
  const before = (await service.current()).tasks[0];
  const { proposal } = await service.call('steward_propose', { projectId: null, type: 'history', chatIds: ['selected-history'] });
  const assignments = [{ chatId: 'selected-history', projectId: project.id, projectTitle: '', taskId, title: '模型拟定的新名称', description: '模型拟定的新说明' }];
  runtime.complete(proposal.chatId, 'completed', { assignments }); await service.board.flush();
  await service.store.mutate((s) => { s.projects[0].transitionId = 'another-window-stopping'; });
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments }), /正在停止/);
  await service.store.mutate((s) => { s.projects[0].transitionId = null; });
  const result = await service.call('steward_apply_proposal', { id: proposal.id, assignments }); const state = await service.current();
  assert.equal(state.projects.length, 1); assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].title, before.title); assert.equal(state.tasks[0].description, before.description);
  assert.equal(state.tasks[0].confirmedHash, before.confirmedHash); assert.equal(state.tasks[0].mainChatId, 'existing-main'); assert.deepEqual(state.tasks[0].relatedChatIds, ['selected-history']); assert.deepEqual(result.projectIds, [project.id]);
});

test('只有历史整理允许不选项目，无选择或重复选择不读取聊天也不产生草案', async () => {
  const { service, runtime } = await emptySetup();
  for (const type of ['split', 'criteria', 'question', 'review']) await assert.rejects(service.call('steward_propose', { type }), /选择项目/);
  await assert.rejects(service.call('steward_propose', { type: 'history' }), /来源聊天/);
  await assert.rejects(service.call('steward_propose', { type: 'history', chatIds: ['duplicate', 'duplicate'] }), /不重复/);
  const state = await service.current(); assert.equal(state.projects.length, 0); assert.equal(state.proposals.length, 0); assert.equal(runtime.historyReads.length, 0); assert.equal(runtime.starts.length, 0);
});

test('多个窗口同时开始首页整理只建立一个生成回合', async () => {
  const { service, runtime } = await emptySetup(); runtime.threads.set('selected', { id: 'selected', name: '已选聊天', turns: [] });
  const input = { type: 'history', chatIds: ['selected'] }; const results = await Promise.allSettled([service.call('steward_propose', input), service.call('steward_propose', input)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.match(results.find((r) => r.status === 'rejected').reason.message, /已有同类草案/);
  assert.equal(runtime.starts.length, 1); assert.equal((await service.current()).proposals.length, 1); assert.equal((await service.current()).projects.length, 0);
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

async function occupiedSetup() {
  const context = await setup(), { service, runtime, project } = context, id = await ready(service, project.id);
  await service.call('steward_task_confirm', { id });
  runtime.threads.set('desktop-chat', { id: 'desktop-chat', name: '历史主聊天', turns: [{ id: 'history-turn', status: 'completed', items: [{ id: 'history-item', type: 'agentMessage', text: '已有任务上下文' }] }] });
  await service.call('steward_chat_attach', { taskId: id, chatId: 'desktop-chat', main: true }); runtime.busyChats.add('desktop-chat');
  return { ...context, id };
}

test('拖入进行中遇到 writer 占用时保留大小卡阶段、标准和聊天，不启动或自动 fork', async () => {
  const { service, runtime, id } = await occupiedSetup(), before = await service.current();
  const result = await service.call('steward_task_move', { id, phase: 'active', expectedPhase: 'ready' });
  assert.equal(result.blocked, true); assert.match(result.message, /尚未启动/); assert.ok(!result.message.includes('desktop-chat'));
  const state = await service.current(); assert.equal(state.projects[0].phase, before.projects[0].phase);
  for (const key of ['phase', 'confirmedHash', 'mainChatId', 'runId', 'turnId', 'deliveryHash']) assert.deepEqual(state.tasks[0][key], before.tasks[0][key]);
  assert.equal(state.tasks[0].execution, 'blocked'); assert.equal(runtime.starts.length, 0); assert.equal(runtime.forks.length, 0);
  await assert.rejects(service.call('steward_chat_send', { taskId: id, message: '继续' }), /处理主聊天占用/);
});

test('待验收返工的占用保留历史成果、标准与修改意见，重试发送同一主聊天', async () => {
  const { service, runtime, project } = await setup(), id = await ready(service, project.id);
  await service.call('steward_task_confirm', { id }); const { task } = await service.call('steward_task_start', { id }); await deliver(service, runtime, task);
  const before = (await service.current()).tasks[0]; runtime.busyChats.add(task.mainChatId);
  const result = await service.call('steward_task_start', { id, feedback: '请修正布局并保留旧成果' }); assert.equal(result.blocked, true);
  await service.call('steward_task_start', { id }); const blocked = (await service.current()).tasks[0];
  for (const key of ['phase', 'runId', 'turnId', 'delivery', 'deliveryHash', 'confirmedHash', 'mainChatId']) assert.deepEqual(blocked[key], before[key]);
  assert.equal(blocked.blockedRequest.feedback, '请修正布局并保留旧成果');
  await assert.rejects(service.call('steward_task_report', { id, runId: before.runId, state: 'running', progress: '旧回写' }), /过期/);
  runtime.busyChats.clear(); const resumed = await service.call('steward_task_start', { id }); assert.equal(resumed.task.mainChatId, before.mainChatId);
  assert.equal(resumed.task.execution, 'running'); assert.equal(resumed.task.blockedRequest, null); assert.match(runtime.starts.at(-1).prompt, /请修正布局并保留旧成果/);
});

test('确认接续只 fork 一次，历史和原主聊天保留，后续继续新主聊天', async () => {
  const { service, runtime, id } = await occupiedSetup(); const { task } = await service.call('steward_task_start', { id });
  const confirmation = { id, expectedMainChatId: task.mainChatId, expectedHash: task.confirmedHash };
  const results = await Promise.allSettled([service.call('steward_task_continue', confirmation), service.call('steward_task_continue', confirmation)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(runtime.forks.length, 1); assert.equal(runtime.starts.length, 1);
  const current = (await service.current()).tasks[0]; assert.notEqual(current.mainChatId, 'desktop-chat'); assert.deepEqual(current.relatedChatIds, ['desktop-chat']);
  assert.match(current.progress, /任务已发送/); assert.ok(!current.progress.includes('尚未发送'));
  assert.equal(runtime.threads.get(current.mainChatId).turns[0].items[0].text, '已有任务上下文'); assert.equal(runtime.threads.get('desktop-chat').turns.length, 1);
  runtime.complete(current.mainChatId); await service.board.flush(); await service.call('steward_task_start', { id });
  assert.equal(runtime.starts.at(-1).chatId, current.mainChatId); assert.equal(runtime.forks.length, 1);
});

test('接续确认过期和原聊天仍在执行时不创建、不推进，编辑目标清除待发请求', async () => {
  const { service, runtime, id } = await occupiedSetup(); const { task } = await service.call('steward_task_start', { id });
  const confirmation = { id, expectedMainChatId: task.mainChatId, expectedHash: task.confirmedHash };
  await assert.rejects(service.call('steward_task_continue', { ...confirmation, expectedMainChatId: 'stale' }), /已变化/);
  await assert.rejects(service.call('steward_task_continue', { ...confirmation, expectedHash: 'stale' }), /已变化/);
  runtime.threads.get('desktop-chat').turns.at(-1).status = 'inProgress';
  const result = await service.call('steward_task_continue', confirmation); assert.equal(result.blocked, true); assert.equal(result.task.blockedRequest.reason, 'active');
  assert.equal(runtime.forks.length, 0); assert.equal(runtime.starts.length, 0); assert.equal(result.task.phase, 'ready');
  await service.call('steward_task_update', { id, title: task.title, description: '新目标', criteria: task.criteria });
  const edited = (await service.current()).tasks[0]; assert.equal(edited.blockedRequest, null); assert.equal(edited.execution, 'idle'); assert.equal(edited.confirmedHash, null);
  await assert.rejects(service.call('steward_task_continue', confirmation), /确认当前/);
});

test('旧版本失败 writer 无执行回合时迁为占用，不恢复或重发任务；备份导入清除待发请求', async () => {
  const { service, runtime, dataDir, id } = await occupiedSetup();
  await service.store.mutate((state) => { const task = state.tasks[0]; task.execution = 'failed'; task.runId = 'never-started'; task.error = 'thread desktop-chat already has an active writer'; });
  const recovered = createService({ dataDir, runtime }); const task = (await recovered.current()).tasks[0];
  assert.equal(task.id, id); assert.equal(task.execution, 'blocked'); assert.equal(task.runId, null); assert.equal(task.phase, 'ready'); assert.equal(runtime.starts.length, 0);
  await recovered.store.mutate((state) => { state.tasks[0].blockedRequest.message = '待发补充说明'; });
  const backup = (await recovered.call('steward_export')).data;
  const importDir = await fs.mkdtemp(path.resolve('_work/import-conflict-')); const imported = createService({ dataDir: importDir, runtime: new MockCodex() });
  await imported.call('steward_import', { data: backup }); const restored = (await imported.current()).tasks[0];
  assert.equal(restored.execution, 'idle'); assert.equal(restored.blockedRequest, null); assert.equal(restored.mainChatId, task.mainChatId);
});
