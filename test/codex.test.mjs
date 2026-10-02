import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexConnection } from '../src/server/codex.mjs';

function transport() {
  const messages = [], children = [];
  const spawnProcess = () => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.send = (message) => child.stdout.write(JSON.stringify(message) + '\n');
    child.kill = () => { child.stdout.end(); child.stdin.end(); child.emit('exit', 0); };
    child.stdin.on('data', (bytes) => {
      const message = JSON.parse(bytes.toString()); messages.push(message);
      if (!message.method || message.id === undefined) return;
      const results = { initialize: {}, 'account/read': { account: { type: 'chatgpt' } }, 'thread/start': { thread: { id: 'chat', status: { type: 'idle' } } }, 'thread/resume': { thread: { id: 'chat', status: { type: 'idle' } } }, 'thread/name/set': {}, 'turn/start': { turn: { id: 'turn', status: 'inProgress' } }, 'turn/interrupt': {} };
      queueMicrotask(() => child.send(message.method in results ? { id: message.id, result: results[message.method] } : { id: message.id, error: { code: -32000, message: '服务器拒绝操作' } }));
    });
    children.push(child); return child;
  };
  const runtime = new CodexConnection({ spawnProcess, workspace: 'F:\\workspace' });
  return { runtime, messages, children };
}

test('App Server 单次握手、结构化只读回合与 RPC 错误', async (t) => {
  const { runtime, messages, children } = transport(); t.after(() => runtime.close());
  await Promise.all([runtime.connect(), runtime.connect()]); assert.equal(children.length, 1); assert.deepEqual(await runtime.status(), { connected: true, authenticated: true });
  await runtime.thread(null, '测试', { readOnly: true, ephemeral: true });
  const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
  await runtime.start('chat', '只读草案', { kind: 'proposal', id: 'draft' }, schema);
  assert.equal(messages.find((m) => m.method === 'thread/start').params.cwd, 'F:\\workspace'); assert.equal(messages.find((m) => m.method === 'thread/start').params.sandbox, 'read-only');
  assert.deepEqual(messages.find((m) => m.method === 'turn/start').params.sandboxPolicy, { type: 'readOnly' }); assert.deepEqual(messages.find((m) => m.method === 'turn/start').params.outputSchema, schema);
  await assert.rejects(runtime.call('unknown'), /服务器拒绝/);
});

test('中断只在对应执行实际结束后成功，重复停止已结束执行无需再发请求', async (t) => {
  const { runtime, messages, children } = transport(); t.after(() => runtime.close()); await runtime.connect();
  runtime.receive({ method: 'turn/started', params: { threadId: 'chat', turn: { id: 'turn' } } });
  let stopped = false; const stopping = runtime.interrupt('chat', 'turn').then(() => { stopped = true; }); await new Promise(setImmediate);
  assert.equal(stopped, false); assert.ok(messages.some((m) => m.method === 'turn/interrupt'));
  children[0].send({ method: 'turn/completed', params: { threadId: 'another-chat', turn: { id: 'turn', status: 'interrupted' } } }); await new Promise(setImmediate); assert.equal(stopped, false);
  children[0].send({ method: 'turn/completed', params: { threadId: 'chat', turn: { id: 'turn', status: 'interrupted' } } }); await stopping;
  await runtime.interrupt('chat', 'turn'); assert.equal(messages.filter((m) => m.method === 'turn/interrupt').length, 1);
});

test('用户请求不自动批准，拒绝未知协议，校验回答与表单，权限仅限当前回合', async (t) => {
  const { runtime, messages } = transport(); t.after(() => runtime.close()); await runtime.connect();
  runtime.receive({ id: 'unsupported', method: 'unknown/request', params: {} }); assert.equal(messages.at(-1).error.code, -32601);
  runtime.receive({ id: 1, method: 'item/permissions/requestApproval', params: { threadId: 'chat', permissions: { network: { enabled: true } } } }); assert.equal(runtime.requests.size, 1);
  assert.throws(() => runtime.reply('1', {}), /明确同意/); runtime.reply('1', { accept: true }); assert.deepEqual(messages.at(-1).result, { permissions: { network: { enabled: true } }, scope: 'turn' });
  runtime.receive({ id: 2, method: 'item/tool/requestUserInput', params: { threadId: 'chat', questions: [{ id: 'choice', question: '选择？' }] } }); assert.throws(() => runtime.reply('2', { answers: {} }), /所有问题/); runtime.reply('2', { answers: { choice: { answers: ['用户选择'] } } });
  runtime.receive({ id: 3, method: 'mcpServer/elicitation/request', params: { threadId: 'chat', mode: 'form', requestedSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'] } } });
  assert.throws(() => runtime.reply('3', { accept: true, content: { count: '1' } }), /表单格式/); runtime.reply('3', { accept: true, content: { count: 2 } }); assert.deepEqual(messages.at(-1).result, { action: 'accept', content: { count: 2 } });
});

test('连接断开使未完成 RPC 失败，重连后旧进程事件不影响新连接', async (t) => {
  const { runtime, children } = transport(); t.after(() => runtime.close()); await runtime.connect();
  const pending = runtime.request('initialize'); children[0].emit('exit', 1); await assert.rejects(pending, /已断开/);
  await runtime.connect(); assert.equal(children.length, 2); children[0].emit('exit', 1); assert.equal(runtime.connected, true);
});

test('聊天列表核对完整分页与返回目录，避免旧 cwd 索引漏项，排除临时和其他项目', async () => {
  const runtime = new CodexConnection({ workspace: 'F:\\workspace' }), calls = [];
  const thread = (id, cwd, name = id) => ({ id, cwd, name, updatedAt: 100, status: { type: 'notLoaded' } });
  runtime.call = async (method, params) => { calls.push({ method, params }); return params.cursor ? { data: [thread('old-index', 'f:/WORKSPACE/'), thread('subproject', 'F:\\workspace\\Self'), { ...thread('ephemeral', 'F:\\workspace'), ephemeral: true }], nextCursor: null } : { data: [thread('regular', 'F:\\workspace'), thread('auxiliary', 'F:\\workspace'), thread('other', 'D:\\another')], nextCursor: 'page-two' }; };
  const result = await runtime.list({ excludeIds: ['auxiliary'] });
  assert.deepEqual(result.threads.map((t) => t.id), ['regular', 'old-index']); assert.equal(result.total, 2); assert.equal(result.excludedCount, 1);
  assert.equal(calls.length, 2); assert.equal(calls[1].params.cursor, 'page-two');
  assert.ok(calls.every(({ method, params }) => method === 'thread/list' && !('cwd' in params) && !('searchTerm' in params)));
  assert.ok(calls[0].params.sourceKinds.includes('appServer')); assert.deepEqual(calls[0].params.modelProviders, []);
});

test('标题搜索忽略英文大小写，用户分页使用稳定快照，新聊天不使后页遗漏或重复', async () => {
  const runtime = new CodexConnection({ workspace: 'F:\\workspace' }); let calls = 0;
  const threads = Array.from({ length: 35 }, (_, i) => ({ id: `chat-${i}`, name: `Codex 项目 ${i}`, cwd: 'F:\\workspace', updatedAt: 100 - i }));
  runtime.call = async () => { calls++; return { data: threads, nextCursor: null }; };
  const first = await runtime.list({ search: 'codex' }); assert.equal(first.threads.length, 30); assert.equal(first.total, 35); assert.ok(first.nextCursor);
  threads.unshift({ id: 'new', name: 'Codex 新聊天', cwd: 'F:\\workspace', updatedAt: 101 });
  const last = await runtime.list({ cursor: first.nextCursor, search: 'CODEX' }); assert.equal(last.threads.length, 5); assert.equal(last.nextCursor, null); assert.equal(calls, 1);
  assert.equal(new Set([...first.threads, ...last.threads].map((t) => t.id)).size, 35);
  await assert.rejects(runtime.list({ cursor: first.nextCursor, search: 'other' }), /重新读取/);
  assert.equal((await runtime.list({ search: 'codex' })).total, 36);
  runtime.call = async () => ({ data: [], nextCursor: 'repeated' }); await assert.rejects(runtime.list(), /分页没有继续/);
});
