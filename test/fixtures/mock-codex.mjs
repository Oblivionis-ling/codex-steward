import { EventEmitter } from 'node:events';

export class MockCodex extends EventEmitter {
  constructor() { super(); this.requests = new Map(); this.contexts = new Map(); this.activeTurns = new Map(); this.completed = new Set(); this.threads = new Map(); this.counter = 0; this.starts = []; this.interrupts = []; this.historyReads = []; this.failStops = new Set(); }
  async status() { return { connected: true, authenticated: true }; }
  async thread(chatId, title) { if (chatId) { if (!this.threads.has(chatId)) this.threads.set(chatId, { id: chatId, name: title, turns: [] }); return this.threads.get(chatId); } const id = `test-chat-${++this.counter}`; const thread = { id, name: title, turns: [] }; this.threads.set(id, thread); return thread; }
  async start(chatId, prompt, context, outputSchema) {
    const turn = { id: `test-turn-${++this.counter}`, status: 'inProgress', items: [] };
    this.contexts.set(chatId, context); this.activeTurns.set(chatId, turn.id); this.threads.get(chatId).turns.push(turn); this.starts.push({ chatId, prompt, context, outputSchema, turnId: turn.id });
    this.emit('notification', { method: 'turn/started', params: { threadId: chatId, turn } });
    this.onStart?.({ chatId, prompt, context, outputSchema, turn }); return turn;
  }
  complete(chatId, status = 'completed', result) {
    const thread = this.threads.get(chatId), turn = thread.turns.at(-1); turn.status = status;
    if (result !== undefined) turn.items.push({ id: `answer-${turn.id}`, type: 'agentMessage', phase: 'final', text: typeof result === 'string' ? result : JSON.stringify(result) });
    this.activeTurns.delete(chatId); this.completed.add(`${chatId}:${turn.id}`);
    this.emit('turnCompleted', { threadId: chatId, turn }); this.emit('notification', { method: 'turn/completed', params: { threadId: chatId, turn } });
  }
  async interrupt(chatId, turnId) { this.interrupts.push({ chatId, turnId }); if (this.failStops.has(chatId)) throw new Error('测试：未收到停止确认'); this.complete(chatId, 'interrupted'); }
  async history(chatId) { this.historyReads.push(chatId); const thread = this.threads.get(chatId); if (!thread) throw new Error('不存在的聊天'); return structuredClone(thread); }
  async list() { return { threads: [...this.threads.values()].map((t) => ({ id: t.id, title: t.name, status: { type: 'idle' } })), nextCursor: null }; }
  async call(method) { if (method === 'turn/steer') return {}; throw new Error('未实现的测试请求'); }
  publicRequests(chatIds) { return [...this.requests.values()].filter((r) => chatIds.has(r.params.threadId)).map((r) => ({ ...r, id: String(r.id) })); }
  reply(id) { const request = this.requests.get(id); this.requests.delete(id); this.emit('notification', { method: 'serverRequest/resolved', params: { threadId: request.params.threadId, requestId: id } }); }
  close() {}
}
