import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** The official app-server protocol. Authentication and permissions remain Codex-owned. */
export class CodexConnection extends EventEmitter {
  constructor({ command = process.env.STEWARD_CODEX_PATH || 'codex.exe', workspace = process.env.STEWARD_WORKSPACE || 'F:\\workspace', spawnProcess = spawn } = {}) {
    super(); this.command = command; this.workspace = workspace; this.spawnProcess = spawnProcess;
    this.serial = 0; this.pending = new Map(); this.requests = new Map(); this.contexts = new Map(); this.completed = new Set(); this.activeTurns = new Map(); this.items = new Map(); this.chatListings = new Map(); this.connected = false;
  }
  async connect() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      this.proc = this.spawnProcess(this.command, ['app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: this.workspace });
      const child = this.proc;
      this.proc.stderr.on('data', () => {});
      this.lines = readline.createInterface({ input: this.proc.stdout });
      this.lines.on('line', (line) => { if (this.proc !== child) return; try { this.receive(JSON.parse(line)); } catch { /* Non-protocol stdout cannot become a state update. */ } });
      let exited = false;
      const lost = () => { if (this.proc !== child || exited) return; exited = true; this.connected = false; this.connecting = null; for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Codex 连接已断开，请重新连接后检查任务。')); } this.pending.clear(); this.requests.clear(); this.activeTurns.clear(); this.emit('disconnected'); };
      this.proc.on('error', lost); this.proc.on('exit', lost);
      await this.request('initialize', { clientInfo: { name: 'personal_steward', title: '个人管家', version: '0.2.2' }, capabilities: { experimentalApi: true } });
      this.write({ method: 'initialized' }); this.connected = true;
    })();
    try { await this.connecting; } catch (error) { this.proc?.kill(); this.connecting = null; throw error; }
  }
  write(message) { if (!this.proc?.stdin.writable) throw new Error('Codex 未连接。'); this.proc.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 操作超时：${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async call(method, params = {}) { await this.connect(); return this.request(method, params); }
  receive(message) {
    if (message.id !== undefined && !message.method) {
      const request = this.pending.get(message.id); if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || 'Codex 操作失败。')); else request.resolve(message.result);
      return;
    }
    if (message.id !== undefined) {
      const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput', 'item/permissions/requestApproval', 'mcpServer/elicitation/request'];
      if (!supported.includes(message.method)) { this.write({ id: message.id, error: { code: -32601, message: 'This client does not handle this request.' } }); return; }
      this.requests.set(String(message.id), message); this.emit('request', message); return;
    }
    if (message.method === 'serverRequest/resolved') this.requests.delete(String(message.params.requestId));
    if (['item/started', 'item/completed'].includes(message.method)) { this.items.set(`${message.params.threadId}:${message.params.item.id}`, message.params.item); if (this.items.size > 500) this.items.delete(this.items.keys().next().value); }
    if (message.method === 'turn/started') this.activeTurns.set(message.params.threadId, message.params.turn.id);
    if (message.method === 'turn/completed') { if (this.activeTurns.get(message.params.threadId) === message.params.turn.id) this.activeTurns.delete(message.params.threadId); this.completed.add(`${message.params.threadId}:${message.params.turn.id}`); if (this.completed.size > 1000) this.completed.delete(this.completed.values().next().value); this.emit('turnCompleted', message.params); }
    this.emit('notification', message);
  }
  async status() { try { const result = await this.call('account/read', {}); return { connected: true, authenticated: !!result.account }; } catch (error) { return { connected: false, authenticated: false, error: error.message }; } }
  async thread(chatId, title, { readOnly = false, ephemeral = false } = {}) {
    const result = chatId ? await this.call('thread/resume', { threadId: chatId, cwd: this.workspace, excludeTurns: true }) : await this.call('thread/start', { cwd: this.workspace, ephemeral, ...(readOnly ? { sandbox: 'read-only' } : {}) });
    const thread = result.thread;
    if (thread.status?.type === 'active') throw new Error('主聊天已有执行或等待请求，请在主聊天处理后继续。');
    if (!chatId && !ephemeral) {
      const date = new Intl.DateTimeFormat('en-GB', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date()).split('/').reverse().join('');
      await this.call('thread/name/set', { threadId: thread.id, name: `${date}|${readOnly ? '规划' : '开发'}|${title.slice(0, 18)}` });
    }
    return thread;
  }
  async start(chatId, prompt, context, outputSchema) {
    this.contexts.set(chatId, context);
    const result = await this.call('turn/start', { threadId: chatId, input: [{ type: 'text', text: prompt, text_elements: [] }], ...(outputSchema ? { outputSchema, sandboxPolicy: { type: 'readOnly' } } : {}) });
    return result.turn;
  }
  async interrupt(chatId, turnId) {
    if (!turnId) throw new Error('执行仍在启动，请稍后再停止。');
    const key = `${chatId}:${turnId}`;
    if (this.completed.has(key)) return;
    if (this.activeTurns.get(chatId) !== turnId) {
      const thread = await this.history(chatId), turn = thread.turns?.find((t) => t.id === turnId);
      if (this.completed.has(key)) return;
      if (!turn) throw new Error('无法确认原执行状态，请查看主聊天后重试停止。');
      if (turn.status !== 'inProgress') { this.completed.add(key); return; }
      await this.call('thread/resume', { threadId: chatId, cwd: this.workspace, excludeTurns: true });
    }
    let resolveWait, rejectWait;
    const waiting = new Promise((resolve, reject) => { resolveWait = resolve; rejectWait = reject; });
    const listener = (params) => { if (params.threadId === chatId && params.turn.id === turnId) resolveWait(); };
    const disconnected = () => rejectWait(new Error('停止时连接断开，未取得停止确认。'));
    this.on('turnCompleted', listener);
    this.on('disconnected', disconnected);
    const timer = setTimeout(() => rejectWait(new Error('未收到停止确认，已保留任务阶段。')), 20000);
    // Attach rejection handling before awaiting the interrupt acknowledgement.
    waiting.catch(() => {});
    try { await this.call('turn/interrupt', { threadId: chatId, turnId }); if (!this.completed.has(key)) await waiting; }
    finally { clearTimeout(timer); this.off('turnCompleted', listener); this.off('disconnected', disconnected); }
  }
  async history(chatId) { const result = await this.call('thread/read', { threadId: chatId, includeTurns: true }); return result.thread; }
  async list({ cursor, search = '', excludeIds = [] } = {}) {
    const query = search.trim().toLocaleLowerCase(), now = Date.now();
    for (const [key, snapshot] of this.chatListings) if (now - snapshot.createdAt > 1800000) this.chatListings.delete(key);
    let key, offset = 0, snapshot;
    if (cursor) {
      const match = /^([a-f0-9-]{36}):(\d+)$/.exec(cursor);
      key = match?.[1]; offset = Number(match?.[2]); snapshot = this.chatListings.get(key);
      if (!snapshot || snapshot.query !== query || !Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.threads.length) throw new Error('聊天列表已更新，请点击刷新重新读取。');
    } else {
      const normalize = (value) => typeof value === 'string' && value ? path.win32.normalize(value).replace(/[\\/]+$/, '').toLocaleLowerCase() : null;
      const workspace = normalize(this.workspace), excluded = new Set(excludeIds), threads = new Map(), seenCursors = new Set();
      let pageCursor = null, excludedCount = 0;
      do {
        // The indexed cwd can lag behind the cwd repaired from session logs.
        // Read every metadata page before comparing the returned, normalized cwd.
        const result = await this.call('thread/list', { limit: 100, cursor: pageCursor, sortKey: 'updated_at', modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'unknown'], archived: false });
        for (const thread of result.data) {
          if (thread.ephemeral || normalize(thread.cwd) !== workspace) continue;
          if (excluded.has(thread.id)) { excludedCount++; continue; }
          const title = thread.name || thread.preview || '未命名聊天';
          if (!query || title.toLocaleLowerCase().includes(query)) threads.set(thread.id, { id: thread.id, title, updatedAt: thread.updatedAt, status: thread.status });
        }
        pageCursor = result.nextCursor ?? null;
        if (pageCursor && seenCursors.has(pageCursor)) throw new Error('聊天分页没有继续，请刷新后重试。');
        if (pageCursor) seenCursors.add(pageCursor);
      } while (pageCursor);
      key = randomUUID(); snapshot = { query, threads: [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt), excludedCount, createdAt: Date.now() };
      this.chatListings.set(key, snapshot);
      if (this.chatListings.size > 10) this.chatListings.delete(this.chatListings.keys().next().value);
    }
    const end = offset + 30;
    return { threads: snapshot.threads.slice(offset, end), total: snapshot.threads.length, excludedCount: snapshot.excludedCount, workspace: this.workspace, nextCursor: end < snapshot.threads.length ? `${key}:${end}` : null };
  }
  publicRequests(chatIds) { return [...this.requests.values()].filter((r) => chatIds.has(r.params.threadId)).map((r) => ({ id: String(r.id), method: r.method, threadId: r.params.threadId, params: r.params, item: this.items.get(`${r.params.threadId}:${r.params.itemId}`) || null })); }
  reply(id, response) {
    const request = this.requests.get(id); if (!request) throw new Error('这个请求已经结束。');
    let result;
    if (request.method === 'item/tool/requestUserInput') { for (const question of request.params.questions) if (!response.answers?.[question.id]?.answers?.some((answer) => answer.trim())) throw new Error('请回答所有问题后提交。'); result = { answers: response.answers }; }
    else if (typeof response.accept !== 'boolean') throw new Error('请明确同意或拒绝本次请求。');
    else if (request.method === 'item/permissions/requestApproval') result = { permissions: response.accept ? request.params.permissions : {}, scope: 'turn' };
    else if (request.method === 'mcpServer/elicitation/request') {
      let content;
      if (response.accept && request.params.mode !== 'url') { const schema = { ...request.params.requestedSchema }; if (schema.required === null) delete schema.required; try { content = z.fromJSONSchema(schema).parse(response.content || {}); } catch { throw new Error('回答不符合请求的表单格式，请检查字段。'); } }
      result = { action: response.accept ? 'accept' : 'decline', ...(content ? { content } : {}) };
    }
    else result = { decision: response.accept ? 'accept' : 'decline' };
    this.write({ id: request.id, result }); this.requests.delete(id);
  }
  close() { this.proc?.kill(); this.lines?.close(); this.connected = false; }
}
