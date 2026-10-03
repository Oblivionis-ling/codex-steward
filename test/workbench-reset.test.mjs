import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { WorkbenchStore, USER } from '../src/server/workbench-store.mjs';
import { emptyState } from '../src/server/store.mjs';
import { newProject, newTask } from '../src/server/board-model.mjs';

const run=promisify(execFile);
test('清空包含归档、评论、关系和整理建议；快照可恢复，旧JSON不复活，编号重新开始', async (t) => {
  const root=path.resolve('_work');await mkdir(root,{recursive:true});
  const dir=await mkdtemp(path.join(root,'reset-test-'));
  t.after(async () => {assert.ok(dir.startsWith(root+path.sep));await rm(dir,{recursive:true,force:true});});
  const state=emptyState(),p=newProject({title:'旧项目'}),task=newTask({projectId:p.id,title:'旧任务',phase:'active'});
  task.mainChatId='native-source';state.projects.push(p);state.tasks.push(task);
  const original=JSON.stringify(state);await writeFile(path.join(dir,'steward.json'),original);
  let s=new WorkbenchStore(dir,'F:\\workspace');
  const c=s.cards()[0],child=s.create({title:'归档子卡',parentId:c.id});
  const comment=s.db.createComment(c.id,{body:'评论原文',actor:{type:'user',id:'ling',name:'我',avatarUrl:null}});
  s.db.archiveTask(child.id,child.version,undefined,undefined,USER);
  s.importJob({id:'suggestion',status:'ready',createdAt:new Date().toISOString(),result:{assignments:[]}});
  const db=s.db.database;
  db.prepare("INSERT INTO attachments (id, task_id, comment_id, kind, filename, content_type, size, created_at) VALUES ('attachment', ?, ?, 'attachment', 'test.txt', 'text/plain', 1, ?)").run(c.id,comment.id,new Date().toISOString());
  const counts={cards:1,archivedCards:1,imports:1};s.close();
  const {stdout}=await run(process.execPath,['scripts/reset-workbench.mjs',dir,'CLEAR_RECORDS']);
  const result=JSON.parse(stdout.trim());assert.deepEqual(result.removed,counts);assert.equal(result.remaining,0);
  const restored=path.join(dir,'restored');await mkdir(restored);await copyFile(result.backup,path.join(restored,'workbench.sqlite'));
  const copy=new WorkbenchStore(restored,'F:\\workspace');
  assert.equal(copy.cards().length,1);assert.equal(copy.cards({archived:true}).length,1);assert.equal(copy.jobs().length,1);
  assert.equal(copy.cards()[0].threadId,'native-source');assert.equal(copy.cards()[0].comments.at(-1).body,'评论原文');copy.close();
  s=new WorkbenchStore(dir,'F:\\workspace');
  for (const table of ['tasks','steward_details','comments','task_activities','attachments','task_relations','steward_imports','ai_chat_threads','ai_chat_runs','ai_chat_events']) assert.equal(s.db.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
  assert.equal(s.migration(),null);assert.equal(await readFile(path.join(dir,'steward.json'),'utf8'),original);
  assert.deepEqual(s.db.database.prepare('PRAGMA foreign_key_check').all(),[]);
  const fresh=s.create({title:'清空后新灵感'});assert.equal(fresh.identifier,'LOCAL-1');s.close();
  s=new WorkbenchStore(dir,'F:\\workspace');assert.equal(s.cards().length,1);assert.equal(s.cards()[0].title,'清空后新灵感');s.close();
});

test('同一打开的库清空后可直接创建新卡，未显式指定清空时CLI不改数据', async (t) => {
  const root=path.resolve('_work');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'reset-guard-test-'));
  const s=new WorkbenchStore(dir,'F:\\workspace');
  t.after(async () => {s.close();assert.ok(dir.startsWith(root+path.sep));await rm(dir,{recursive:true,force:true});});
  s.create({title:'保留灵感'});
  await assert.rejects(run(process.execPath,['scripts/reset-workbench.mjs',dir]),/CLEAR_RECORDS/);
  assert.equal(s.cards().length,1);assert.equal(s.cards()[0].title,'保留灵感');
  s.clearRecords();assert.equal(s.cards().length,0);assert.equal(s.create({title:'重新开始'}).identifier,'LOCAL-1');
});
