import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createService } from '../src/server/tools.mjs';
import { chatSourceHash, historySource } from '../src/server/history-progress.mjs';
import { isSingleProject, inferredProjectPhase, historyProjectPreview } from '../src/shared/card-layout.js';
import { dropIntent } from '../src/ui/transitions.js';
import { MockCodex } from './fixtures/mock-codex.mjs';

async function setup() {
  await fs.mkdir('_work', { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('_work/progress-test-')), runtime = new MockCodex();
  return { service: createService({ dataDir, runtime }), runtime, dataDir };
}
function source(runtime, chatId = 'history-chat', { accepted = false, running = false } = {}) {
  const turns = [{ id: 'scope', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: '制作可打开的工具，并给出可核对的结果。' }] }] }, { id: 'delivery', status: 'completed', items: [{ type: 'agentMessage', phase: 'final', text: '工具已交付，验证结果和打开方式已提供，等待你验收。' }] }];
  if (accepted) turns.push({ id: 'acceptance', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: '我已经检查结果，验收通过，这个项目可以结项。' }] }] });
  if (running) turns.push({ id: 'new-work', status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text: '还有新的修改需要完成。' }] }] });
  const thread = { id: chatId, name: '历史工具', turns }; runtime.threads.set(chatId, thread); return thread;
}
const assessment = (accepted = false) => ({ summary: accepted ? '用户已确认结果完成' : '工具已交付，等待用户验收', reason: accepted ? '交付后用户明确表示验收通过。' : '已有可核对成果，尚无用户验收。', confidence: 'high', evidence: accepted ? [{ turnId: 'acceptance', role: 'user', quote: '验收通过，这个项目可以结项。' }] : [{ turnId: 'delivery', role: 'assistant', quote: '工具已交付，验证结果和打开方式已提供' }] });
const assignment = (chatId = 'history-chat', phase = 'review', extra = {}) => ({ chatId, projectId: null, projectTitle: '历史工具', taskId: null, title: '制作工具', description: '制作可打开的工具，并提供可核对结果。', phase, assessment: assessment(phase === 'done'), ...extra });
async function proposalFor(service, runtime, assignments) {
  const { proposal } = await service.call('steward_propose', { type: 'history', chatIds: assignments.map((a) => a.chatId) });
  runtime.complete(proposal.chatId, 'completed', { assignments }); await service.board.flush();
  return (await service.current()).proposals.find((p) => p.id === proposal.id);
}
async function importHistory(context, assignments) {
  const proposal = await proposalFor(context.service, context.runtime, assignments);
  assert.equal(proposal.status, 'ready', proposal.error);
  const result = await context.service.call('steward_apply_proposal', { id: proposal.id, assignments: proposal.result.assignments, confirmProgress: true });
  return { proposal, result, state: await context.service.current() };
}

test('新建单卡不发送聊天，执行、送验、结项与重开只需一个阶段', async () => {
  const { service, runtime } = await setup();
  const { project, task } = await service.call('steward_card_create', { title: '单聊天项目', description: '制作可打开的结果' });
  assert.equal(isSingleProject(await service.current(), project), true); assert.equal(runtime.starts.length, 0);
  await service.call('steward_task_move', { id: task.id, phase: 'ready' });
  assert.equal((await service.current()).projects[0].phase, 'ready');
  await service.call('steward_task_update', { id: task.id, title: task.title, description: task.description, criteria: ['可打开'] });
  await service.call('steward_task_confirm', { id: task.id }); const running = (await service.call('steward_task_start', { id: task.id })).task;
  await service.call('steward_submit_delivery', { id: task.id, runId: running.runId, hash: running.confirmedHash, report: { summary: '结果完成', checks: [{ criterion: '可打开', passed: true, evidence: '验证通过' }], materials: [] } });
  runtime.complete(running.mainChatId); await service.board.flush(); assert.equal((await service.current()).projects[0].phase, 'review');
  await service.call('steward_task_move', { id: task.id, phase: 'done' }); let state = await service.current(); assert.equal(state.projects[0].phase, 'done');
  await service.call('steward_project_reopen', { id: project.id }); state = await service.current();
  assert.equal(state.projects[0].phase, 'ready'); assert.equal(state.tasks[0].phase, 'ready'); assert.equal(state.tasks[0].mainChatId, running.mainChatId); assert.ok(state.tasks[0].delivery); assert.equal(state.tasks[0].deliveryHash, null); assert.equal(runtime.starts.length, 1);
});

test('按需拆分保留原卡、主聊天和进度，项目资料仍由相同项目引用', async () => {
  const context = await setup(), { service, runtime } = context; source(runtime);
  const { state } = await importHistory(context, [assignment()]), before = structuredClone(state.tasks[0]);
  await service.call('steward_create', { type: 'material', projectId: before.projectId, title: '原资料', content: '原项目决定' });
  await service.call('steward_task_create', { projectId: before.projectId, title: '新的独立任务', description: '另一个交付' });
  const after = await service.current(); assert.equal(isSingleProject(after, after.projects[0]), false); assert.equal(after.projects[0].phase, 'active');
  assert.deepEqual(after.tasks[0], before); assert.equal(after.records[0].projectId, before.projectId); assert.equal(after.tasks.length, 2); assert.equal(runtime.starts.length, 1);
});

test('旧单任务项目自动合为单卡阶段，显式分组项目保留二次验收', async () => {
  const { service, runtime, dataDir } = await setup();
  for (const layout of ['auto', 'group']) {
    const { project } = await service.call('steward_project_create', { title: layout, layout }); await service.call('steward_task_create', { projectId: project.id, title: layout });
  }
  await service.store.mutate((s) => { for (const p of s.projects) { p.phase = 'review'; if (p.layout === 'auto') delete p.layout; } for (const t of s.tasks) t.phase = 'done'; });
  const recovered = createService({ dataDir, runtime }), state = await recovered.current();
  assert.equal(state.projects.find((p) => p.title === 'auto').phase, 'done'); assert.equal(state.projects.find((p) => p.title === 'group').phase, 'review'); assert.equal(state.tasks.length, 2); assert.equal(runtime.starts.length, 0);
});

test('长聊天保留原目标与最新需求，角色和回合可核对，中段变化也会让快照失效', async () => {
  const { service, runtime } = await setup(), thread = source(runtime);
  thread.turns.splice(1, 0, { id: 'long-middle', status: 'completed', items: [{ type: 'agentMessage', text: '中间过程'.repeat(12000) }] });
  thread.turns.push({ id: 'latest', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: '最新需求仍未完成，继续修改导入逻辑。' }] }] });
  const excerpt = historySource(thread); assert.ok(excerpt.transcript.length <= 18000); assert.match(excerpt.transcript, /制作可打开的工具/); assert.match(excerpt.transcript, /最新需求仍未完成/); assert.match(excerpt.transcript, /role=user/); assert.match(excerpt.transcript, /turnId=latest/);
  const hash = chatSourceHash(thread); thread.turns[1].items[0].text += '变化'; assert.notEqual(chatSourceHash(thread), hash);
  await service.call('steward_propose', { type: 'history', chatIds: [thread.id] }); assert.match(runtime.starts[0].prompt, /最新需求仍未完成/); assert.match(runtime.starts[0].prompt, /不能用旧成果覆盖新需求/); assert.deepEqual(runtime.historyReads, [thread.id]);
  thread.turns.at(-1).items[0].content[0].text = '长消息'.repeat(9000) + '最后仍有未完成需求。'; const largeLastMessage = historySource(thread);
  assert.match(largeLastMessage.transcript, /最后仍有未完成需求/); assert.equal(largeLastMessage.latestMessage.turnId, 'latest'); assert.equal(largeLastMessage.latestMessage.role, 'user');
});

test('只有 Codex 宣称完成时建议待验收，缺少原文时降为低可信度且不声称交付', async () => {
  const { service, runtime } = await setup(); source(runtime);
  let proposal = await proposalFor(service, runtime, [assignment('history-chat', 'done', { assessment: assessment() })]);
  assert.equal(proposal.result.assignments[0].phase, 'review'); assert.match(proposal.result.assignments[0].assessment.reason, /未提供用户验收/);
  proposal = await proposalFor(service, runtime, [assignment('history-chat', 'review', { assessment: { ...assessment(), evidence: [] } })]);
  assert.equal(proposal.result.assignments[0].phase, 'ready'); assert.equal(proposal.result.assignments[0].assessment.confidence, 'low');
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments: [assignment('history-chat', 'done', { assessment: { ...assessment(), evidence: [] } })], confirmProgress: true }), /需要可核对/);
  assert.equal((await service.current()).tasks.length, 0);
});

test('进度原文的伪造内容、角色和回合均被拒绝，不能产生卡片', async () => {
  const { service, runtime } = await setup(); source(runtime);
  for (const evidence of [{ turnId: 'delivery', role: 'assistant', quote: '虚构的全部通过' }, { turnId: 'delivery', role: 'user', quote: '工具已交付' }, { turnId: '不存在', role: 'assistant', quote: '工具已交付' }]) {
    const proposal = await proposalFor(service, runtime, [assignment('history-chat', 'review', { assessment: { ...assessment(), evidence: [evidence] } })]);
    assert.equal(proposal.status, 'error'); assert.match(proposal.error, /依据与来源聊天不符/);
  }
  assert.equal((await service.current()).tasks.length, 0);
});

test('用户确认前不写阶段，编辑后的建议同时保存任务和项目进度，不伪造标准与执行', async () => {
  const { service, runtime } = await setup(); source(runtime);
  const proposal = await proposalFor(service, runtime, [assignment()]);
  await assert.rejects(service.call('steward_apply_proposal', { id: proposal.id, assignments: proposal.result.assignments }), /明确确认/); assert.equal((await service.current()).projects.length, 0);
  const edited = [{ ...proposal.result.assignments[0], phase: 'active', title: '用户改名' }];
  await service.call('steward_apply_proposal', { id: proposal.id, assignments: edited, confirmProgress: true }); const state = await service.current(), task = state.tasks[0];
  assert.equal(task.phase, 'active'); assert.equal(state.projects[0].phase, 'active'); assert.equal(task.title, '用户改名'); assert.equal(task.progress, assessment().summary);
  assert.equal(task.execution, 'idle'); assert.equal(task.runId, null); assert.equal(task.turnId, null); assert.equal(task.confirmedHash, null); assert.equal(task.delivery, null); assert.deepEqual(task.criteria, []); assert.equal(task.historyProgress.eligible, false); assert.equal(runtime.starts.length, 1);
});

test('多任务进度完整汇总；全部历史验收后项目待验收，项目结项仍由用户操作', async () => {
  const context = await setup(); for (const id of ['a', 'b']) source(context.runtime, id, { accepted: true });
  const assignments = ['a', 'b'].map((chatId) => assignment(chatId, 'done', { projectTitle: '同一个长期项目' }));
  const preview = historyProjectPreview(assignments, { projects: [], tasks: [] }); assert.equal(preview[0].phase, 'review'); assert.equal(preview[0].single, false);
  const { state } = await importHistory(context, assignments); assert.equal(state.projects.length, 1); assert.equal(state.projects[0].phase, preview[0].phase); assert.ok(state.tasks.every((t) => t.phase === 'done'));
  await context.service.call('steward_project_move', { id: state.projects[0].id, phase: 'done' }); assert.equal((await context.service.current()).projects[0].phase, 'done');
  for (const [stages, expected] of [[['idea', 'idea'], 'idea'], [['idea', 'ready'], 'ready'], [['ready', 'active'], 'active'], [['review', 'done'], 'active'], [['done', 'idea'], 'active'], [['done', 'done'], 'review']]) assert.equal(inferredProjectPhase(stages.map((phase) => ({ phase }))), expected);
});

test('历史待验收卡可拖动验收，确认后单卡结项，不使用虚构的运行报告', async () => {
  const context = await setup(); source(context.runtime); const { state } = await importHistory(context, [assignment()]);
  const task = state.tasks[0]; assert.equal(dropIntent(task, 'task', 'done', state).action, 'acceptTask');
  await context.service.call('steward_task_move', { id: task.id, phase: 'done', expectedPhase: 'review' });
  const after = await context.service.current(); assert.equal(after.tasks[0].phase, 'done'); assert.equal(after.projects[0].phase, 'done'); assert.equal(after.tasks[0].delivery, null); assert.equal(after.tasks[0].confirmedHash, null); assert.match(after.tasks[0].progress, /已结项/);
  assert.equal(after.tasks[0].historyProgress.assessment.evidence[0].quote, assessment().evidence[0].quote);
});

test('生成期间与保存前的新消息均让旧进度建议失效', async () => {
  const { service, runtime } = await setup(), thread = source(runtime);
  const { proposal } = await service.call('steward_propose', { type: 'history', chatIds: [thread.id] });
  thread.turns.push({ id: 'changed', status: 'completed', items: [{ type: 'userMessage', text: '新增需求需要继续。' }] }); runtime.complete(proposal.chatId, 'completed', { assignments: [assignment()] }); await service.board.flush();
  assert.equal((await service.current()).proposals[0].status, 'error'); assert.match((await service.current()).proposals[0].error, /新进展/);
  const next = await proposalFor(service, runtime, [assignment()]); thread.turns.push({ id: 'changed-again', status: 'completed', items: [{ type: 'userMessage', text: '又有新的要求。' }] });
  await assert.rejects(service.call('steward_apply_proposal', { id: next.id, assignments: next.result.assignments, confirmProgress: true }), /新进展/); assert.equal((await service.current()).tasks.length, 0);
});

test('目标卡片改动阻止旧建议；有效的进度更新保留原说明、标准和主聊天', async () => {
  const { service, runtime } = await setup(); source(runtime); source(runtime, 'original-main');
  const { project, task } = await service.call('steward_card_create', { title: '原名称', description: '用户原目标' });
  await service.call('steward_task_update', { id: task.id, title: task.title, description: task.description, criteria: ['用户原标准'] }); await service.call('steward_task_confirm', { id: task.id }); await service.call('steward_chat_attach', { taskId: task.id, chatId: 'original-main', main: true });
  const destination = assignment('history-chat', 'review', { projectId: project.id, taskId: task.id, title: '模型建议改名', description: '模型建议新目标' });
  let p = await proposalFor(service, runtime, [destination]); await service.call('steward_task_move', { id: task.id, phase: 'ready' });
  await assert.rejects(service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true }), /已有变化/);
  p = await proposalFor(service, runtime, [destination]); await service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true });
  const state = await service.current(); assert.equal(state.tasks[0].title, task.title); assert.equal(state.tasks[0].description, task.description); assert.deepEqual(state.tasks[0].criteria, ['用户原标准']); assert.ok(state.tasks[0].confirmedHash); assert.equal(state.tasks[0].mainChatId, 'original-main'); assert.deepEqual(state.tasks[0].relatedChatIds, ['history-chat']); assert.equal(state.tasks[0].phase, 'review');
});

test('历史验收检查来源新进展，编辑标准和回退都会撤销旧证据的验收资格', async () => {
  const context = await setup(), thread = source(context.runtime); let { state } = await importHistory(context, [assignment()]); let task = state.tasks[0];
  thread.turns.push({ id: 'new-work', status: 'completed', items: [{ type: 'userMessage', text: '还有改动。' }] });
  await assert.rejects(context.service.call('steward_task_move', { id: task.id, phase: 'done' }), /新进展/);
  thread.turns.pop(); await context.service.call('steward_task_move', { id: task.id, phase: 'done' }); await context.service.call('steward_task_move', { id: task.id, phase: 'review' });
  await assert.rejects(context.service.call('steward_task_move', { id: task.id, phase: 'done' }), /对应交付/);
  state = await context.service.current(); assert.equal(state.tasks[0].historyProgress.eligible, false); assert.ok(state.tasks[0].historyProgress.assessment.evidence.length);
  const second = await setup(); source(second.runtime); ({ state } = await importHistory(second, [assignment()])); task = state.tasks[0];
  await second.service.call('steward_task_update', { id: task.id, title: task.title, description: task.description, criteria: ['新的标准'] }); const edited = (await second.service.current()).tasks[0];
  assert.equal(edited.phase, 'ready'); assert.equal(edited.historyProgress.eligible, false); assert.equal((await second.service.current()).projects[0].phase, 'ready');
});

test('仍在执行的聊天强制进行中，导入不接管执行；回退需取得真实停止确认', async () => {
  const context = await setup(); source(context.runtime, 'history-chat', { accepted: true, running: true });
  const p = await proposalFor(context.service, context.runtime, [assignment('history-chat', 'done')]); assert.equal(p.result.assignments[0].phase, 'active');
  await assert.rejects(context.service.call('steward_apply_proposal', { id: p.id, assignments: [{ ...p.result.assignments[0], phase: 'done' }], confirmProgress: true }), /仍在执行/);
  await context.service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true }); const task = (await context.service.current()).tasks[0]; assert.equal(task.execution, 'idle'); assert.equal(task.runId, null);
  context.runtime.failStops.add('history-chat'); await assert.rejects(context.service.call('steward_task_move', { id: task.id, phase: 'ready' }), /停止确认/); assert.equal((await context.service.current()).tasks[0].phase, 'active');
  context.runtime.failStops.clear(); await context.service.call('steward_task_move', { id: task.id, phase: 'ready' }); assert.equal(context.runtime.interrupts.at(-1).turnId, 'new-work'); assert.equal((await context.service.current()).tasks[0].phase, 'ready'); assert.equal((await context.service.current()).projects[0].phase, 'ready');
});

test('重导入已关联聊天需要选现有卡片，不能生成重复主聊天卡片', async () => {
  const context = await setup(); source(context.runtime); const { state } = await importHistory(context, [assignment()]);
  const p = await proposalFor(context.service, context.runtime, [assignment()]);
  await assert.rejects(context.service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true }), /已有卡片/); assert.equal((await context.service.current()).tasks.length, 1);
  await context.service.call('steward_apply_proposal', { id: p.id, assignments: [{ ...p.result.assignments[0], projectId: state.projects[0].id, taskId: state.tasks[0].id }], confirmProgress: true }); assert.equal((await context.service.current()).tasks.length, 1);
});

test('伪造新的来源不能触发读取，修改进度原文也不能应用', async () => {
  const { service, runtime } = await setup(); source(runtime); const p = await proposalFor(service, runtime, [assignment()]), before = runtime.historyReads.length;
  await assert.rejects(service.call('steward_apply_proposal', { id: p.id, assignments: [assignment('not-selected')], confirmProgress: true }), /所选/); assert.equal(runtime.historyReads.length, before);
  await assert.rejects(service.call('steward_apply_proposal', { id: p.id, assignments: [assignment('history-chat', 'review', { assessment: { ...assessment(), evidence: [{ turnId: 'delivery', role: 'assistant', quote: '篡改的原文' }] } })], confirmProgress: true }), /不符/); assert.equal((await service.current()).tasks.length, 0);
});

test('同一张卡片不能用多个来源依次覆盖进度', async () => {
  const { service, runtime } = await setup(); source(runtime, 'a'); source(runtime, 'b', { accepted: true });
  const { project, task } = await service.call('steward_card_create', { title: '同一张卡片', description: '保留明确范围' });
  const assignments = [assignment('a', 'review', { projectId: project.id, taskId: task.id }), assignment('b', 'done', { projectId: project.id, taskId: task.id })], p = await proposalFor(service, runtime, assignments);
  const reads = runtime.historyReads.length;
  await assert.rejects(service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true }), /只选择一个来源/);
  assert.equal(runtime.historyReads.length, reads); assert.equal((await service.current()).tasks[0].phase, 'idea');
});

test('关联历史已完成也不能覆盖仍在执行的目标主聊天', async () => {
  const { service, runtime } = await setup(); source(runtime); source(runtime, 'active-main', { running: true });
  const { project, task } = await service.call('steward_card_create', { title: '继续中的卡片', description: '当前目标' }); await service.call('steward_chat_attach', { taskId: task.id, chatId: 'active-main', main: true });
  const p = await proposalFor(service, runtime, [assignment('history-chat', 'review', { projectId: project.id, taskId: task.id })]);
  await assert.rejects(service.call('steward_apply_proposal', { id: p.id, assignments: p.result.assignments, confirmProgress: true }), /主聊天仍在执行/);
  const state = await service.current(); assert.equal(state.tasks[0].phase, 'idea'); assert.deepEqual(state.tasks[0].relatedChatIds, []); assert.equal(state.tasks[0].mainChatId, 'active-main');
});
