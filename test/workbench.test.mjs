import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, rm, access, copyFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createService, validateProgress } from '../src/server/workbench.mjs';
import { WorkbenchStore } from '../src/server/workbench-store.mjs';
import { CodexConnection } from '../src/server/codex.mjs';
import { emptyState } from '../src/server/store.mjs';
import { newProject, newTask } from '../src/server/board-model.mjs';

class NativeMock extends EventEmitter {
  constructor() { super(); this.threads=new Map(); this.calls=[]; }
  async history(id) { this.calls.push(['read',id]); return this.threads.get(id) || {id,status:{type:'idle'},turns:[]}; }
  async interrupt(id) {this.calls.push(['stop',id]);if(this.failStop)throw new Error('writer');this.threads.set(id,{id,status:{type:'idle'},turns:[]});}
  async list() {return {threads:[],total:0,nextCursor:null};}
  close() {}
}
const activeThread = (id) => ({id,status:{type:'active'},turns:[{id:'turn',status:'inProgress',items:[]}]});
async function fixture(t,options={}) {
  await mkdir('_work',{recursive:true});const dir=await mkdtemp(path.resolve('_work/workbench-test-'));
  const runtime=options.runtime || new NativeMock();
  const s=createService({...options,dataDir:dir,runtime});
  t.after(async () => {await s.settle();s.close();await rm(dir,{recursive:true,force:true});});return s;
}
const create = async (s,description='一个零散灵感',parentId) => (await s.call('steward_card_create',{description,...(parentId ? {parentId}: {})})).card;
const read = (s,id) => s.store.card(id);
const prepare = (s,c,mode) => s.call('steward_card_prepare',{id:c.id,version:c.version,mode});
const record = (s,c,p,fields) => s.call('steward_card_record',{id:c.id,token:p.token,...fields});

test('零散灵感无需标准可构思，盘问/调研可重复且不启动独立执行器',async (t) => {
  const s=await fixture(t);let c=await create(s);assert.equal(c.phase,'idea');assert.equal(c.parentId,null);
  for (const mode of ['discuss','grill','research','discuss']) {
    const p=await prepare(s,c,mode);assert.equal(p.card.phase,'shaping');assert.match(p.url,/codex:\/\/threads\/new\?/);assert.equal(new URL(p.url).searchParams.get('path'),'F:\\workspace');
    const result=await record(s,c,p,{kind:'draft',draft:`本轮目标-${mode}`,note:'这是讨论草案，尚未决定实施'});c=result.card;assert.equal(c.phase,'shaping');
    await assert.rejects(record(s,c,p,{kind:'delivery',outcome:'构思回答已完成'}),/构思/);
  }
  assert.deepEqual(s.runtime.calls,[]);assert.equal(c.comments.length,4);
});

test('保存草案后明确实施，同一主聊天绑定、交付到待验收，用户确认结项',async (t) => {
  const s=await fixture(t);let c=await create(s);const thought=await prepare(s,c,'grill');
  c=(await record(s,c,thought,{kind:'binding',threadId:'native-main'})).card;
  c=(await record(s,c,thought,{kind:'draft',draft:'做一个仅本机用的灵感工具'})).card;
  const build=await prepare(s,c,'build');assert.equal(build.existing,true);assert.equal(build.url,'codex://threads/native-main');
  await assert.rejects(record(s,c,build,{kind:'draft',draft:'偷换需求'}),/不能改写/);
  c=(await record(s,c,build,{kind:'delivery',outcome:'成果：app.html；构建通过；尚未验证真实导航',note:'最小可运行首版'})).card;assert.equal(c.phase,'review');
  await assert.rejects(s.call('steward_card_move',{id:c.id,version:c.version,phase:'done'}),/确认验收/);
  c=(await s.call('steward_card_move',{id:c.id,version:c.version,phase:'done',confirm:true})).card;assert.equal(c.phase,'done');assert.equal(c.threadId,'native-main');
});

test('目标编辑与回退使旧token失效，过期结果不能改变新目标或阶段',async (t) => {
  const s=await fixture(t);let c=await create(s);const p=await prepare(s,c,'discuss');c=p.card;
  c=(await s.call('steward_card_update',{id:c.id,version:c.version,patch:{description:'修正后的想法'}})).card;
  await assert.rejects(record(s,c,p,{kind:'draft',draft:'旧目标'}),/旧回合/);
  const next=await prepare(s,c,'build');c=next.card;
  c=(await s.call('steward_card_move',{id:c.id,version:c.version,phase:'shaping'})).card;
  await assert.rejects(record(s,c,next,{kind:'delivery',outcome:'迟到的完成'}),/旧回合/);assert.equal(read(s,c.id).phase,'shaping');
});

test('父卡回退停止所有子任务并重置构思中，停止失败时保留全部阶段',async (t) => {
  const runtime=new NativeMock(),s=await fixture(t,{runtime});let parent=await create(s,'长期项目'),a=await create(s,'子任务A',parent.id),b=await create(s,'子任务B',parent.id);
  const p=await prepare(s,a,'build');a=(await record(s,a,p,{kind:'binding',threadId:'child-chat'})).card;runtime.threads.set('child-chat',activeThread('child-chat'));
  parent=read(s,parent.id);assert.equal(parent.phase,'building');runtime.failStop=true;
  await assert.rejects(s.call('steward_card_move',{id:parent.id,version:parent.version,phase:'shaping',confirm:true}),/请在主聊天停止/);
  assert.equal(read(s,a.id).phase,'building');assert.equal(read(s,parent.id).phase,'building');assert.equal(read(s,b.id).phase,'idea');
  runtime.failStop=false;parent=read(s,parent.id);await s.call('steward_card_move',{id:parent.id,version:parent.version,phase:'shaping',confirm:true});
  assert.equal(read(s,a.id).phase,'shaping');assert.equal(read(s,b.id).phase,'shaping');assert.equal(read(s,a.id).threadId,'child-chat');
  await assert.rejects(record(s,a,p,{kind:'progress',progress:'停止后旧进展'}),/旧回合/);
});

test('所有子卡完成使父卡待验收，归档恢复保留正文与评论',async (t) => {
  const s=await fixture(t);let p=await create(s,'父卡'),c=await create(s,'子卡',p.id);const build=await prepare(s,c,'build');
  c=(await record(s,c,build,{kind:'delivery',outcome:'测试通过'})).card;
  c=(await s.call('steward_card_move',{id:c.id,version:c.version,phase:'done',confirm:true})).card;assert.equal(read(s,p.id).phase,'review');
  await s.call('steward_card_note',{id:c.id,note:'保留经验'});c=read(s,c.id);
  c=(await s.call('steward_card_archive',{id:c.id,version:c.version})).card;assert.ok(c.archivedAt);
  c=(await s.call('steward_card_archive',{id:c.id,version:c.version,restore:true})).card;assert.equal(c.archivedAt,null);assert.equal(c.comments.at(-1).body,'保留经验');
});

test('主聊天防重复关联，版本冲突不覆盖，状态刷新不会改变工作阶段',async (t) => {
  const s=await fixture(t);let a=await create(s),b=await create(s);const p=await prepare(s,a,'discuss');
  a=(await record(s,a,p,{kind:'binding',threadId:'shared'})).card;
  await assert.rejects(s.call('steward_card_link',{id:b.id,version:b.version,threadId:'shared'}),/另一张卡/);
  await s.call('steward_card_link',{id:b.id,version:b.version,threadId:'shared',main:false});
  await assert.rejects(s.call('steward_card_update',{id:a.id,version:1,patch:{title:'旧版本'}}),/已经变化/);
  s.runtime.threads.set('shared',activeThread('shared'));await s.call('steward_sync',{id:a.id});assert.equal(read(s,a.id).phase,'shaping');assert.equal(read(s,a.id).lastChatStatus,'running');
});

test('旧数据迁移保留原文、标准、主聊天、子任务及成果，重复打开不重复迁移',async (t) => {
  await mkdir('_work',{recursive:true});const dir=await mkdtemp(path.resolve('_work/migration-test-'));t.after(() => rm(dir,{recursive:true,force:true}));
  const state=emptyState(),p=newProject({title:'原有单项目'}),group=newProject({title:'原有大卡',layout:'group'});
  const a=newTask({projectId:p.id,title:'原有单任务',description:'保留目标',criteria:['构建通过'],phase:'review'});a.mainChatId='old-chat';a.relatedChatIds=['older-chat'];a.delivery={summary:'成果',checks:[{criterion:'构建通过',passed:true,evidence:'npm run build'}],materials:[]};
  const b=newTask({projectId:group.id,title:'子卡',phase:'active'});state.projects.push(p,group);state.tasks.push(a,b);
  const original=JSON.stringify(state);await writeFile(path.join(dir,'steward.json'),original);
  let s=new WorkbenchStore(dir,'F:\\workspace');assert.equal(s.cards().length,3);let c=s.cards().find((c) => c.title===a.title);assert.equal(c.phase,'review');assert.equal(c.threadId,'old-chat');assert.match(c.draft,/构建通过/);assert.equal(c.outcome,'成果');assert.equal(c.parentId,null);
  assert.ok(s.cards().find((c) => c.title==='子卡').parentId);assert.equal(await readFile(path.join(dir,'steward.json'),'utf8'),original);assert.equal(await readFile(s.migration().backupPath,'utf8'),original);s.close();
  s=new WorkbenchStore(dir,'F:\\workspace');assert.equal(s.cards().length,3);s.close();
});

test('SQLite快照可独立打开，并发保存用版本阻止覆盖',async (t) => {
  const s=await fixture(t);let c=await create(s);await s.call('steward_card_note',{id:c.id,note:'备份保留我记录的内容'});const {filePath}=await s.call('steward_export');await access(filePath);
  const restoredDir=path.join(s.store.dataDir,'restored');await mkdir(restoredDir);await copyFile(filePath,path.join(restoredDir,'workbench.sqlite'));
  const imported=new WorkbenchStore(restoredDir,'F:\\workspace');assert.equal(imported.cards()[0].comments[0].body,'备份保留我记录的内容');imported.close();
  const results=await Promise.allSettled([s.call('steward_card_update',{id:c.id,version:c.version,patch:{draft:'版本A'}}),s.call('steward_card_update',{id:c.id,version:c.version,patch:{draft:'版本B'}})]);
  assert.equal(results.filter((r) => r.status==='fulfilled').length,1);assert.equal(results.filter((r) => r.status==='rejected').length,1);
});

const thread=(id,text='先盘问我的想法') => ({id,name:id,status:{type:'idle'},turns:[{id:'t1',status:'completed',items:[{type:'userMessage',content:[{type:'text',text}]}]}]});
const suggestion=(id,phase='shaping') => ({chatId:id,title:`项目-${id}`,description:'从聊天提取的目标',labels:['自用工具'],phase,assessment:{summary:'正在构思',reason:'用户要求盘问',confidence:'high',evidence:[{turnId:'t1',role:'user',quote:'先盘问我的想法'}]}});
test('聊天分析仅生成草案，确认后建单卡；来源变化时整批拒绝且不启动执行',async (t) => {
  const runtime=new NativeMock();runtime.threads.set('one',thread('one'));const s=await fixture(t,{runtime,analyze:async () => ({assignments:[suggestion('one')]})});
  const {job}=await s.call('steward_history_analyze',{chatIds:['one']});await s.settle();assert.equal(s.store.cards().length,0);
  runtime.threads.set('one',thread('one','出现了新想法'));await assert.rejects(s.call('steward_history_apply',{jobId:job.id,assignments:[suggestion('one')]}),/新消息/);assert.equal(s.store.cards().length,0);
  runtime.threads.set('one',thread('one'));await s.call('steward_history_apply',{jobId:job.id,assignments:[suggestion('one')]});const c=s.store.cards()[0];assert.equal(c.phase,'shaping');assert.equal(c.parentId,null);assert.equal(c.threadId,'one');assert.equal(c.session,null);
  await assert.rejects(s.call('steward_history_apply',{jobId:job.id,assignments:[suggestion('one')]}),/已结束/);
});

test('原文引用必须匹配，无用户验收只能待验收，构思执行状态与阶段分离',() => {
  const t=thread('one');assert.throws(() => validateProgress({...suggestion('one'),assessment:{...suggestion('one').assessment,evidence:[{turnId:'fake',role:'user',quote:'不存在'}]}},t),/核对/);
  const quote='全部目标已交付，请最终验收';
  const a={...suggestion('one','done'),assessment:{...suggestion('one').assessment,evidence:[{turnId:'t1',role:'assistant',quote}],milestones:[{kind:'handoff',turnId:'t1',role:'assistant',quote}]}};
  const assistant={...t,turns:[{id:'t1',status:'completed',items:[{type:'agentMessage',text:quote}]}]};assert.equal(validateProgress(a,assistant).phase,'review');
  assert.equal(validateProgress(suggestion('one'),{...t,status:{type:'active'}}).phase,'shaping');
});

test('完整历程校正自动整理建议；保存时保留用户手动选择的阶段',async (t) => {
  const runtime=new NativeMock();runtime.threads.set('one',thread('one','请制作第一版'));
  const a={...suggestion('one'),assessment:{...suggestion('one').assessment,evidence:[{turnId:'t1',role:'user',quote:'请制作第一版'}],milestones:[{kind:'work_started',turnId:'t1',role:'user',quote:'请制作第一版'}]}};
  const s=await fixture(t,{runtime,analyze:async () => ({assignments:[a]})});
  const {job}=await s.call('steward_history_analyze',{chatIds:['one']});await s.settle();
  const suggested=s.store.jobs().find((j) => j.id===job.id).result.assignments[0];assert.equal(suggested.phase,'building');
  await s.call('steward_history_apply',{jobId:job.id,assignments:[{...suggested,phase:'shaping'}]});
  assert.equal(s.store.cards()[0].phase,'shaping');assert.equal(s.store.cards()[0].threadId,'one');
});

test('列表包括workspace子目录，避免相近目录误入；所有本机范围不漏其它项目',async () => {
  const runtime=new CodexConnection({workspace:'F:\\workspace'});
  runtime.call=async () => ({data:[{id:'root',cwd:'F:\\workspace',updatedAt:3},{id:'child',cwd:'F:\\workspace\\project',updatedAt:2},{id:'nearby',cwd:'F:\\workspace-other',updatedAt:1},{id:'outside',cwd:'D:\\Desktop',updatedAt:0}],nextCursor:null});
  assert.deepEqual((await runtime.list({includeDescendants:true})).threads.map((c) => c.id),['root','child']);
  assert.equal((await runtime.list({allWorkspaces:true})).total,4);
});

test('父卡停止期间不能新增、启动或改写遗漏子任务，停止完成后解除锁',async (t) => {
  const runtime=new NativeMock(),s=await fixture(t,{runtime});let p=await create(s,'父项目'),c=await create(s,'运行中的子卡',p.id);
  const run=await prepare(s,c,'build');c=(await record(s,c,run,{kind:'binding',threadId:'live'})).card;
  runtime.threads.set('live',activeThread('live'));let release,entered;
  const stopped=new Promise((resolve) => {entered=resolve;});runtime.interrupt=async () => {entered();await new Promise((resolve) => {release=resolve;});runtime.threads.set('live',{id:'live',status:{type:'idle'},turns:[]});};
  p=read(s,p.id);const moving=s.call('steward_card_move',{id:p.id,version:p.version,phase:'shaping'});await stopped;
  await assert.rejects(create(s,'回退时不能漏入的新子卡',p.id),/正在停止/);
  await assert.rejects(prepare(s,c,'build'),/正在停止/);
  await assert.rejects(record(s,c,run,{kind:'progress',progress:'迟到的进度'}),/正在停止/);
  release();await moving;assert.equal(read(s,p.id).transitionId,null);assert.equal(read(s,c.id).phase,'shaping');
});

test('长需求使用卡片读取保持原文完整，原生预填链接长度可用',async (t) => {
  const s=await fixture(t);let c=await create(s,'长需求'.repeat(9000));c=(await s.call('steward_card_update',{id:c.id,version:c.version,patch:{draft:'完整草案'.repeat(7000)}})).card;
  const p=await prepare(s,c,'build');assert.ok(p.url.length<30000);assert.equal(read(s,c.id).description.length,27000);assert.equal(read(s,c.id).draft.length,28000);assert.match(p.prompt,/完整草案请读取卡片/);
});
