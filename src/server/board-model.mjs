import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';

const text = (n) => z.string().max(n);
export const phaseSchema = z.enum(['idea', 'ready', 'active', 'review', 'done']);
export const phases = ['idea', 'ready', 'active', 'review', 'done'];
export const phaseNames = { idea: '灵感池', ready: '待启动', active: '进行中', review: '待验收', done: '已结项' };
export const criteriaSchema = z.array(z.string().trim().min(1).max(1500)).max(30);
export const projectSchema = z.object({ id: text(80), title: text(240), goal: text(30000), phase: phaseSchema, transitionId: text(80).nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export const deliverySchema = z.object({ summary: z.string().min(1).max(8000), checks: z.array(z.object({ criterion: z.string().max(1500), passed: z.boolean(), evidence: z.string().min(1).max(3000) })).min(1).max(30), materials: z.array(z.object({ title: z.string().min(1).max(240), content: z.string().min(1).max(30000) })).max(15).default([]) });
export const taskSchema = z.object({
  id: text(80), projectId: text(80), title: text(240), description: text(30000), phase: phaseSchema, sourceRecordId: text(80).nullable().default(null), sourceActionKey: text(240).nullable().default(null),
  criteria: criteriaSchema, confirmedHash: text(100).nullable(), mainChatId: text(100).nullable(), relatedChatIds: z.array(text(100)).max(100),
  runId: text(80).nullable(), turnId: text(100).nullable(), execution: z.enum(['idle', 'starting', 'running', 'waiting', 'failed', 'stopping', 'blocked']),
  blockedRequest: z.object({ reason: z.enum(['writer', 'active']), feedback: text(10000).optional(), message: text(10000).optional() }).nullable().default(null),
  progress: text(1200), error: text(2000), pendingDelivery: deliverySchema.nullable(), delivery: deliverySchema.nullable(), deliveryHash: text(100).nullable().default(null),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const proposalSchema = z.object({ id: text(80), projectId: text(80).nullable(), taskId: text(80).nullable(), type: z.enum(['split', 'criteria', 'history', 'question', 'review']), status: z.enum(['running', 'ready', 'applied', 'error', 'cancelled']), sourceHash: text(100), selectedChatIds: z.array(text(100)).max(30).default([]), sourceHashes: z.record(z.string(), z.string()).default({}), question: text(3000).default(''), from: text(30).default(''), to: text(30).default(''), chatId: text(100).nullable(), turnId: text(100).nullable(), result: z.unknown(), error: text(2000), createdAt: z.string().datetime() });
export function newProject({ title, goal = '' }) { const now = new Date().toISOString(); return projectSchema.parse({ id: randomUUID(), title: title.trim(), goal: goal.trim(), phase: 'idea', createdAt: now, updatedAt: now }); }
export function newTask({ projectId, title, description = '', criteria = [], phase = 'idea' }) { const now = new Date().toISOString(); return taskSchema.parse({ id: randomUUID(), projectId, title: title.trim(), description: description.trim(), criteria, phase, confirmedHash: null, mainChatId: null, relatedChatIds: [], runId: null, turnId: null, execution: 'idle', progress: '', error: '', pendingDelivery: null, delivery: null, createdAt: now, updatedAt: now }); }
export const taskHash = (task) => createHash('sha256').update(JSON.stringify([task.title, task.description, task.criteria])).digest('hex');
export const projectHash = (project) => createHash('sha256').update(JSON.stringify([project.title, project.goal])).digest('hex');
export function requireProject(state, id) { const item = state.projects.find((p) => p.id === id); if (!item) throw new Error('项目不存在。'); return item; }
export function requireUnlockedProject(state, id) { const project = requireProject(state, id); if (project.transitionId) throw new Error('整个项目正在停止并回退，请完成后再操作。'); return project; }
export function requireTask(state, id) { const item = state.tasks.find((t) => t.id === id); if (!item) throw new Error('子任务不存在。'); return item; }
export function touch(item) { item.updatedAt = new Date().toISOString(); }
export function updateParent(state, projectId) { const project = requireProject(state, projectId); const children = state.tasks.filter((t) => t.projectId === projectId); if (project.phase !== 'done' && children.length && children.every((t) => t.phase === 'done')) { project.phase = 'review'; touch(project); } }
export function migrateState(raw) {
  if (raw.version === 2) return raw;
  if (raw.version !== 1) throw new Error('不支持的数据版本。');
  const state = { ...raw, version: 2, projects: [], tasks: [], proposals: [] };
  if (raw.records.length || raw.insights.length) {
    const project = newProject({ title: '原有记录', goal: '从 0.1.0 保留的想法、资料、待办和回顾。' }); project.id = 'legacy-project'; state.projects.push(project);
    state.records = raw.records.map((r) => ({ ...r, projectId: project.id, sourceChatId: null }));
    state.insights = raw.insights.map((r) => ({ ...r, projectId: project.id }));
    for (const record of raw.records.filter((r) => r.type === 'todo')) { const task = newTask({ projectId: project.id, title: record.title, description: record.content, phase: record.completed ? 'done' : 'ready' }); task.id = record.id; task.createdAt = record.createdAt; task.updatedAt = record.updatedAt; state.tasks.push(task); }
  }
  return state;
}
