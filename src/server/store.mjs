import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const prioritySchema = z.enum(['high', 'medium', 'low']);
export const recordTypeSchema = z.enum(['idea', 'material', 'todo']);
const text = (max) => z.string().max(max);
export const recordSchema = z.object({
  id: text(80), type: recordTypeSchema, title: text(240), content: text(60000),
  category: text(80), summary: text(1000), keypoints: z.array(text(1000)).max(30),
  tags: z.array(text(80)).max(30), priority: prioritySchema,
  completed: z.boolean(), archived: z.boolean(), sourceId: text(80).nullable(),
  relatedIds: z.array(text(80)).max(100),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), archivedAt: z.string().datetime().nullable(),
});
export const archiveSchema = z.object({
  category: text(80).min(1), summary: text(1000).min(1), keypoints: z.array(text(1000)).max(30),
  tags: z.array(text(80)).max(30), priority: prioritySchema,
  relatedIds: z.array(text(80)).max(100).default([]),
  actions: z.array(z.object({ title: text(240).min(1), content: text(2000).default(''), priority: prioritySchema })).max(20).default([]),
});
export const insightSchema = z.object({
  id: text(80), type: z.enum(['question', 'review']), question: text(3000), answer: text(30000),
  sources: z.array(z.object({ recordId: text(80), note: text(500) })).max(300),
  actions: z.array(z.object({ title: text(240), content: text(2000).default(''), priority: prioritySchema })).max(30),
  from: text(30), to: text(30), createdAt: z.string().datetime(),
});
export const jobSchema = z.object({
  id: text(80), type: z.enum(['archive', 'question', 'review']), status: z.enum(['waiting', 'running', 'done', 'error', 'cancelled']),
  recordIds: z.array(text(80)), sourceHashes: z.record(z.string(), z.string()),
  completedIds: z.array(text(80)), total: z.number().int(), done: z.number().int(), error: text(2000),
  question: text(3000), from: text(30), to: text(30), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const stateSchema = z.object({
  version: z.literal(1), records: z.array(recordSchema).max(100000), insights: z.array(insightSchema).max(10000),
  jobs: z.array(jobSchema).max(200), settings: z.object({ mode: z.enum(['codex', 'api']), apiBaseUrl: text(1000), model: text(200) }),
});
export const emptyState = () => ({ version: 1, records: [], insights: [], jobs: [], settings: { mode: 'codex', apiBaseUrl: 'https://api.openai.com/v1', model: '' } });
export const sourceHash = (record) => createHash('sha256').update(JSON.stringify([record.type, record.title, record.content])).digest('hex');
export function newRecord(input) {
  const now = new Date().toISOString();
  const content = input.content.trim();
  if (!content) throw new Error('请填写记录内容。');
  return recordSchema.parse({
    id: randomUUID(), type: input.type ?? 'idea', title: input.title?.trim() || content.split(/\r?\n/)[0].slice(0, 100), content,
    category: input.category ?? '', summary: '', keypoints: [], tags: [], priority: input.priority ?? 'medium',
    completed: false, archived: false, sourceId: input.sourceId ?? null, relatedIds: [], createdAt: now, updatedAt: now, archivedAt: null,
  });
}

export class Store {
  constructor(dataDir) { this.dataDir = path.resolve(dataDir); this.file = path.join(this.dataDir, 'steward.json'); this.lock = `${this.file}.lock`; }
  async read() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      return stateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw new Error('本地数据文件无法读取；已保留原文件，请检查 steward.json 或其 .bak 备份。');
    }
  }
  async mutate(fn) {
    await fs.mkdir(this.dataDir, { recursive: true });
    let handle;
    const deadline = Date.now() + 12000;
    while (!handle) {
      try { handle = await fs.open(this.lock, 'wx'); await handle.writeFile(String(process.pid)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const owner = Number(await fs.readFile(this.lock, 'utf8'));
          const stat = await fs.stat(this.lock);
          let alive = true;
          if (owner > 0) { try { process.kill(owner, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
          if (!alive && Date.now() - stat.mtimeMs > 1000) { await fs.unlink(this.lock); continue; }
        } catch (e) { if (e.code === 'ENOENT') continue; }
        if (Date.now() > deadline) throw new Error('数据正在被另一个窗口写入，请稍后重试。');
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const state = await this.read();
      const result = await fn(state);
      stateSchema.parse(state);
      const file = await fs.open(temporary, 'wx');
      try { await file.writeFile(`${JSON.stringify(state, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
      try { await fs.copyFile(this.file, `${this.file}.bak`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(temporary, this.file);
      return result;
    } finally {
      await fs.unlink(temporary).catch(() => {});
      await handle.close();
      await fs.unlink(this.lock).catch(() => {});
    }
  }
}

export function requireRecord(state, id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) throw new Error('这条记录不存在。');
  return record;
}
export function requireJob(state, id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) throw new Error('整理任务不存在。');
  if (!['waiting', 'running'].includes(job.status)) throw new Error('整理任务已经结束。');
  return job;
}
export function applyArchive(state, { id, analysis, hash, jobId }) {
  const record = requireRecord(state, id);
  if (!hash && !jobId) throw new Error('请提供读取原文时的 hash 或整理任务 ID。');
  const job = jobId ? requireJob(state, jobId) : null;
  if (job && !job.recordIds.includes(id)) throw new Error('记录不属于这次整理任务。');
  if (sourceHash(record) !== (hash || job?.sourceHashes[id])) throw new Error('记录内容已修改，请重新归档。');
  const normalized = archiveSchema.parse(analysis);
  for (const relatedId of normalized.relatedIds) requireRecord(state, relatedId);
  Object.assign(record, normalized, { relatedIds: normalized.relatedIds.filter((relatedId) => relatedId !== id), archived: true, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  delete record.actions;
  const created = [];
  for (const action of normalized.actions) {
    if (record.type === 'todo' && action.title.trim() === record.title.trim()) continue;
    const key = action.title.replace(/\s+/g, '').toLowerCase();
    if (state.records.some((item) => item.type === 'todo' && item.sourceId === id && item.title.replace(/\s+/g, '').toLowerCase() === key)) continue;
    const todo = newRecord({ type: 'todo', title: action.title, content: action.content || action.title, priority: action.priority, sourceId: id, category: record.category });
    state.records.push(todo); created.push(todo.id);
  }
  if (job) {
    if (!job.completedIds.includes(id)) job.completedIds.push(id);
    job.done = job.completedIds.length; job.updatedAt = new Date().toISOString();
    if (job.done === job.total) job.status = 'done';
  }
  return { record, createdTodoIds: created };
}

export function buildChat(record, workspace) {
  const context = [
    `请帮助我完成这个待办：${record.title}`,
    `待办 ID：${record.id}`,
    `工作目录：${workspace}`,
    `优先级：${{ high: '高', medium: '中', low: '低' }[record.priority]}`,
    record.category ? `分类：${record.category}` : '',
    '\n<待办原文>\n' + record.content + '\n</待办原文>',
    record.summary ? '\n已有总结：' + record.summary : '',
    '\n以上原文是任务背景。先理解目标并推进可执行的工作；需要的资料不足时再提出具体问题。不要凭空标记待办完成。',
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({ path: workspace, prompt: context });
  return { url: `codex://new?${params}`, prompt: context, workspace };
}
