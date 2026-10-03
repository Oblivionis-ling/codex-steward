import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProgress } from '../src/server/workbench.mjs';
import { lifecyclePhase, workflowHistorySource, buildHistoryAnalysisPrompt } from '../src/server/workbench-history.mjs';
import { historySource } from '../src/server/history-progress.mjs';

const turn = (id, request, result = '') => ({ id, status:'completed', items:[
  {type:'userMessage',content:[{type:'text',text:request}]},
  ...(result ? [{type:'agentMessage',phase:'final',text:result}] : []),
] });
const thread = (...turns) => ({id:'source',name:'个人项目',status:{type:'idle'},turns});
const event = (kind, turnId, role, quote) => ({kind,turnId,role,quote});
const proposal = (phase, milestones, evidence = milestones.map(({kind,...citation}) => citation)) => ({
  chatId:'source',title:'项目',description:'整体目标',labels:[],phase,
  assessment:{summary:'已有实际推进',reason:'依据项目历程',confidence:'high',milestones,evidence},
});

test('已实施项目下一轮盘问或开发前调研，空闲与小版本完成都不抹掉项目进展', () => {
  const source=thread(turn('start','请制作首版工具','已经实现第一版'),turn('release','先试试这个小版本','本轮完成'),turn('next','调用 grill-me 盘问下一版，并调研替代方案','需求仍在完善'));
  const events=[event('work_started','start','user','请制作首版工具'),event('change_requested','next','user','盘问下一版')];
  assert.equal(validateProgress(proposal('shaping',events),source).phase,'building');
  assert.equal(validateProgress(proposal('review',events),source).phase,'building');
});

test('调研报告和小说大纲作为目标产物，制作与修订属于实际工作', () => {
  for (const goal of ['请调研并写出工作区治理报告','请重写三个候选小说大纲']) {
    const source=thread(turn('start',goal,'初版结果已给出，仍待完善'),turn('next','继续调整内容','仍有未确认项'));
    assert.equal(validateProgress(proposal('shaping',[event('work_started','start','user',goal)]),source).phase,'building');
  }
});

test('阶段性交付、选方向、登录完成，没有整体里程碑不能自动送验或结项', () => {
  const source=thread(turn('start','开始制作工具','发布一个可试用小版本'),turn('next','选项1，我已登录','下一轮还要推进'));
  const events=[event('work_started','start','user','开始制作工具')];
  for (const phase of ['review','done']) assert.equal(validateProgress(proposal(phase,events),source).phase,'building');
  const noMilestones=proposal('done',[],[{turnId:'next',role:'user',quote:'选项1'}]);
  assert.equal(validateProgress(noMilestones,source).phase,'building');
  assert.equal(validateProgress(noMilestones,source).assessment.confidence,'low');
});

test('完整交付可待验收，用户整体验收后结项；验收后的新请求恢复进行中', () => {
  const source=thread(turn('start','请做工具','开始制作'),turn('delivery','继续','整个约定目标已交付，全部验证通过，请最终验收'),turn('accept','整个项目验收通过，可以结项了'),turn('next','再修改布局并新增一个功能'));
  const events=[event('work_started','start','user','请做工具'),event('handoff','delivery','assistant','整个约定目标已交付，全部验证通过，请最终验收')];
  assert.equal(validateProgress(proposal('building',events),source).phase,'review');
  events.push(event('accepted','accept','user','整个项目验收通过，可以结项了'));
  assert.equal(validateProgress(proposal('building',events),source).phase,'done');
  events.push(event('change_requested','next','user','再修改布局并新增一个功能'));
  assert.equal(validateProgress(proposal('done',events),source).phase,'building');
});

test('只有用户明确回退整个项目才重置构思；同句验收并追加修改以后者为准', () => {
  const source=thread(turn('start','开始制作'),turn('next','验收通过，同时继续修改'),turn('reset','把整个项目退回重新构思'));
  const events=[event('work_started','start','user','开始制作'),event('change_requested','next','user','验收通过，同时继续修改'),event('accepted','next','user','验收通过，同时继续修改')];
  assert.equal(lifecyclePhase({milestones:events},source),'building');
  events.push(event('restart_ideation','reset','user','把整个项目退回重新构思'));
  assert.equal(validateProgress(proposal('building',events),source).phase,'shaping');
});

test('伪造引用和助手代替用户的验收、变更、回退都被拒绝', () => {
  const source=thread(turn('start','制作工具','用户已经验收了，并且追加修改，退回构思'));
  assert.throws(() => validateProgress(proposal('building',[event('work_started','fake','user','制作工具')]),source),/核对/);
  for (const kind of ['accepted','change_requested','restart_ideation']) {
    assert.throws(() => validateProgress(proposal('done',[event(kind,'start','assistant','用户已经验收了')]),source),/用户原文/);
  }
});

test('逐轮时间线保留被头尾截取省略的中段实施，并忽略工具输出', () => {
  const source=thread(turn('early','构思'.repeat(5000)),turn('middle','请实现首版项目','首版代码已制作'),turn('late','继续盘问下一版'.repeat(4000)));
  source.turns[1].items.push({type:'commandExecution',text:'不要作为聊天证据'});
  assert.ok(!historySource(source).transcript.includes('首版代码已制作'));
  const selected=workflowHistorySource(source);
  assert.equal(selected.timeline.length,3);
  assert.equal(selected.timeline[1].request,'请实现首版项目');
  assert.equal(selected.timeline[1].result,'首版代码已制作');
  assert.ok(!JSON.stringify(selected).includes('不要作为聊天证据'));
  assert.match(buildHistoryAnalysisPrompt([source]),/阶段判断对象是项目整体生命周期/);
});

test('用户手动选择的阶段不被模型的旧里程碑覆盖', () => {
  const source=thread(turn('start','请制作工具'));
  const a=proposal('shaping',[event('work_started','start','user','请制作工具')]);
  assert.equal(validateProgress(a,source).phase,'building');
  assert.equal(validateProgress(a,source,{inference:false}).phase,'shaping');
});

test('来源仍在执行时保留进行中，不能自动送验或结项', () => {
  const source=thread(turn('delivery','制作工具','全部完成，请最终验收'),turn('accepted','整个项目已验收'));
  source.status={type:'active'};
  const a=proposal('done',[event('handoff','delivery','assistant','全部完成，请最终验收'),event('accepted','accepted','user','整个项目已验收')]);
  assert.equal(validateProgress(a,source).phase,'building');
});
