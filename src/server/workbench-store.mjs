import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, writeSync } from 'node:fs';
import { TaskboardDatabase } from '../../vendor/dashi-taskboard/server/database.mjs';
import { statusForStage, stageForStatus } from '../shared/workflow.js';

export const USER = { type: 'user', id: 'ling', name: '我', avatarUrl: null };
export const AGENT = { type: 'agent', id: 'codex', name: 'Codex', avatarUrl: null };
export const contentHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const specificationHash = (card) => contentHash([card.title, card.description, card.draft]);
const defaults = () => ({ draft: '', progress: '', outcome: '', mode: null, session: null, transitionId: null, relatedChatIds: [], importedProgress: null, lastChatStatus: 'unknown', lastSyncedAt: null });

function extendDatabase(db) {
  db.database.exec(`CREATE TABLE IF NOT EXISTS steward_details (task_id TEXT PRIMARY KEY REFERENCES tasks(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS steward_meta (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS steward_imports (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
}

export class WorkbenchStore {
  constructor(dataDir, workspace) {
    this.dataDir = path.resolve(dataDir); this.workspace = workspace;
    this.file = path.join(this.dataDir, 'workbench.sqlite');
    mkdirSync(this.dataDir, { recursive: true });
    if (!existsSync(this.file)) this.initialize();
    this.db = new TaskboardDatabase(this.file); extendDatabase(this.db);
  }
  initialize() {
    const lockPath = `${this.file}.migration.lock`;
    let lock;
    try { lock = openSync(lockPath, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = Number(readFileSync(lockPath, 'utf8')); let alive = true;
      if (Number.isInteger(owner) && owner > 0) { try { process.kill(owner, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; } }
      if (alive) throw new Error('灵感工作台正在迁移数据，请稍后重新打开。');
      unlinkSync(lockPath); lock = openSync(lockPath, 'wx');
    }
    writeSync(lock, String(process.pid));
    const tempPath = path.join(this.dataDir, `.workbench-${randomUUID()}.sqlite`);
    let db;
    try {
      if (existsSync(this.file)) return;
      db = new TaskboardDatabase(tempPath); extendDatabase(db);
      const oldPath = path.join(this.dataDir, 'steward.json');
      const oldText = existsSync(oldPath) ? readFileSync(oldPath, 'utf8') : null;
      if (oldText) {
        // The old file remains authoritative for rollback. Never repair or overwrite it here.
        const old = JSON.parse(oldText);
        if (![1, 2].includes(old.version) || !Array.isArray(old.records) || old.version === 2 && (!Array.isArray(old.projects) || !Array.isArray(old.tasks))) throw new Error('旧版数据格式无法识别；没有写入新版数据，请检查原文件。');
        const backupDir = path.join(this.dataDir, 'backups'); mkdirSync(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `steward-v023-${contentHash(oldText).slice(0, 12)}.json`);
        if (!existsSync(backupPath)) writeFileSync(backupPath, oldText, { flag: 'wx' });
        const map = new Map(), parents = new Map();
        const create = (source, phase) => {
          const c = db.createTask(taskInput({ title: source.title || '原有灵感', description: source.description || source.content || source.goal || '', phase }, this.workspace));
          map.set(source.id, c.id);
          const details = { ...defaults(), draft: source.criteria?.length ? source.criteria.map((x) => `- ${x}`).join('\n') : '', progress: source.progress || '', relatedChatIds: source.relatedChatIds || [], importedProgress: source.historyProgress || null, outcome: source.delivery?.summary || '' };
          db.database.prepare('INSERT INTO steward_details VALUES (?, ?)').run(c.id, JSON.stringify(details));
          if (source.mainChatId || source.sourceChatId) db.updateTask(c.id, c.version, {}, source.mainChatId || source.sourceChatId, undefined, USER);
          if (source.delivery) db.createComment(c.id, { body: `旧版交付记录\n${JSON.stringify(source.delivery, null, 2)}`, actor: AGENT });
          if (source.createdAt) db.database.prepare('UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?').run(source.createdAt, source.updatedAt || source.createdAt, c.id);
          return db.getTask(c.id);
        };
        const phases = { idea: 'idea', ready: 'shaping', active: 'building', review: 'review', done: 'done' };
        for (const p of old.projects || []) {
          const children = (old.tasks || []).filter((t) => t.projectId === p.id);
          if (children.length !== 1 || p.layout === 'group') parents.set(p.id, create(p, phases[p.phase] || 'idea').id);
        }
        for (const t of old.tasks || []) {
          const c = create(t, phases[t.phase] || 'idea');
          const parentId = parents.get(t.projectId);
          if (parentId) db.addTaskRelation(c.id, c.version, 'parent', parentId, undefined, undefined, USER);
          else parents.set(t.projectId, c.id);
        }
        for (const p of old.projects || []) {
          const destination = parents.get(p.id);
          if (destination && p.goal) db.createComment(destination, { body: `旧版项目：${p.title}\n${p.goal}`, actor: USER });
        }
        for (const r of old.records) {
          const destination = map.get(r.sourceId) || parents.get(r.projectId);
          if (destination && r.type !== 'todo') db.createComment(destination, { body: `旧版${r.type === 'idea' ? '灵感' : '资料'}：${r.title}\n${r.content}\n${r.summary || ''}`, actor: USER, threadId: r.sourceChatId || undefined });
          else if (!map.has(r.id)) create(r, r.completed ? 'done' : r.type === 'todo' ? 'shaping' : 'idea');
        }
        for (const insight of old.insights || []) {
          const destination = parents.get(insight.projectId);
          if (destination) db.createComment(destination, { body: `旧版回顾与问答\n${insight.question}\n${insight.answer}`, actor: AGENT });
        }
        db.database.prepare('INSERT INTO steward_meta VALUES (?, ?)').run('legacyMigration', JSON.stringify({ source: oldPath, backupPath, sourceHash: contentHash(oldText), migratedAt: new Date().toISOString(), idMap: Object.fromEntries(map) }));
      }
      db.database.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); db = null;
      renameSync(tempPath, this.file);
    } finally {
      db?.close(); closeSync(lock); unlinkSync(lockPath);
      for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(tempPath + suffix); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    }
  }
  details(id) { return { ...defaults(), ...JSON.parse(this.db.database.prepare('SELECT data FROM steward_details WHERE task_id = ?').get(id)?.data || '{}') }; }
  setDetails(id, patch) {
    const data = { ...this.details(id), ...patch };
    this.db.database.prepare('INSERT INTO steward_details VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(data));
    return data;
  }
  card(id) {
    const t = this.db.getTask(id); if (!t) throw new Error('卡片不存在。');
    return { ...t, ...this.details(t.id), phase: stageForStatus(t.status), parentId: t.relations.parent?.id || null, childIds: t.relations.subIssues.map((c) => c.id), comments: this.db.listComments(t.id) };
  }
  cards({ archived = false } = {}) { return this.db.listTasks({ archived: String(archived) }).map((t) => this.card(t.id)); }
  create(input) {
    const c = this.db.createTask(taskInput(input, this.workspace)); this.setDetails(c.id, { draft: input.draft || '' });
    if (input.parentId) this.db.addTaskRelation(c.id, c.version, 'parent', input.parentId, undefined, undefined, USER);
    return this.card(c.id);
  }
  change(id, version, changes = {}, details = {}, actor = USER, threadId) {
    this.db.updateTask(id, version, changes, threadId, undefined, actor); this.setDetails(id, details); return this.card(id);
  }
  importJob(job) { this.db.database.prepare('INSERT INTO steward_imports VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job)); return job; }
  jobs() { return this.db.database.prepare('SELECT data FROM steward_imports').all().map((r) => JSON.parse(r.data)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  migration() { return JSON.parse(this.db.database.prepare("SELECT data FROM steward_meta WHERE key='legacyMigration'").get()?.data || 'null'); }
  close() { this.db.close(); }
}

function taskInput(input, workspace) {
  return { projectId: 'local', title: input.title, description: input.description || '', status: statusForStage(input.phase || 'idea'), priority: input.priority || 'medium', labels: input.labels || [], actor: USER, assignee: USER, startDate: null, dueDate: null };
}
