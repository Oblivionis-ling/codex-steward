import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MessageSquare, Send, X, CircleAlert, Plus } from 'lucide-react';
import { Button, Icon } from './components.jsx';
import { call, openLink, isEmbedded, localValue, saveLocalValue } from './bridge.js';
import { EXEC_NAMES } from './board.jsx';

export function ChatDock({ task, tasks, project, select, close, perform, busy, notify, attach, request, openRequest, demo }) {
  const [history, setHistory] = useState(null), [message, setMessage] = useState(task ? localValue(`chat-draft:${task.id}`) : '');
  const transcript = useRef(null), follow = useRef(true);
  useEffect(() => {
    if (!task?.mainChatId) return;
    let alive = true;
    const read = async () => {
      try { const result = demo ? { messages: [{ id: 'example', role: 'assistant', text: '任务进展、你的补充说明和 Codex 的回复会显示在这个独立区域。' }] } : await call('steward_chat_history', { taskId: task.id }); if (alive) setHistory(result); }
      catch (error) { if (alive) setHistory({ error: error.message }); }
    };
    read(); const timer = setInterval(() => { if (document.visibilityState === 'visible') read(); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [task?.id, task?.mainChatId, demo]);
  useEffect(() => { if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [history]);
  const write = (value) => { setMessage(value); if (task && !demo) saveLocalValue(`chat-draft:${task.id}`, value); };
  const canSend = task?.mainChatId && ['active', 'review'].includes(task.phase) && !['starting', 'stopping'].includes(task.execution);
  const send = async (event) => { event.preventDefault(); if (!canSend || busy || !message.trim() || demo) return; if (await perform('steward_chat_send', { taskId: task.id, message }, '消息已发送到主聊天')) { write(''); follow.current = true; } };
  return <aside className="chat-dock" aria-label="任务主聊天">
    <header className="chat-dock-header"><h2><Icon as={MessageSquare} size={17}/>任务聊天</h2><button className="icon-button" aria-label="收起任务聊天" onClick={close}><Icon as={X} size={17}/></button></header>
    <label className="chat-task-select"><span className="sr-only">选择聊天任务</span><select aria-label="选择聊天任务" value={task?.id || ''} onChange={(e) => select(e.target.value || null)}><option value="">选择一张子任务卡</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    {task ? <><div className="chat-context"><strong>{task.title}</strong><span>{project?.title} · {EXEC_NAMES[task.execution] || '主聊天'}</span>{task.mainChatId && !demo && (isEmbedded() ? <button className="text-button" onClick={() => openLink(`codex://threads/${encodeURIComponent(task.mainChatId)}`).catch((e) => notify(e.message))}>在 Codex 打开<Icon as={ArrowUpRight} size={13}/></button> : <a href={`codex://threads/${encodeURIComponent(task.mainChatId)}`}>在 Codex 打开<Icon as={ArrowUpRight} size={13}/></a>)}</div>
      {request && <button className="chat-request" onClick={() => openRequest(request.id)}><Icon as={CircleAlert} size={16}/>有问题等你回答</button>}
      <div className="dock-transcript" ref={transcript} onScroll={() => { const el = transcript.current; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 60; }}>
        {!task.mainChatId ? <div className="chat-empty"><Icon as={MessageSquare} size={24}/><p>启动后沿用这张小卡的主聊天</p><span>确认验收标准，把小卡拖到进行中。</span></div> : history?.error ? <p className="inline-error">{history.error}</p> : !history ? <p className="setting-note">正在读取聊天…</p> : history.messages.length ? history.messages.map((m) => <article key={m.id} className={`chat-message ${m.role}`}><strong>{m.role === 'user' ? '你' : 'Codex'}</strong>{m.text.length > 800 ? <><p>{m.text.slice(0, 180)}…</p><details className="long-message"><summary>查看完整消息</summary><p>{m.text}</p></details></> : <p>{m.text}</p>}</article>) : <p className="setting-note">还没有聊天消息。</p>}
      </div>
      {task.relatedChatIds.length > 0 && <details className="dock-related"><summary>关联聊天 · {task.relatedChatIds.length}</summary>{task.relatedChatIds.map((id) => <a key={id} href={`codex://threads/${encodeURIComponent(id)}`}>{id.slice(0, 8)}<Icon as={ArrowUpRight} size={12}/></a>)}</details>}
      <form className="dock-composer" onSubmit={send}><label><span className="sr-only">发给任务主聊天</span><textarea aria-label="发给任务主聊天" placeholder={canSend ? '补充说明或回答 Codex…' : task.phase === 'done' ? '已结项，回退后可继续' : '启动小卡后可发送消息'} value={message} maxLength={10000} disabled={!canSend || demo} onChange={(e) => write(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}/></label><div className="dock-send-row"><Button kind="text" type="button" disabled={busy || demo} onClick={() => attach(task.id)}><Icon as={Plus} size={14}/>关联聊天</Button><Button kind="primary" disabled={busy || !canSend || !message.trim() || demo}><Icon as={Send} size={14}/>发送</Button></div></form>
    </> : <div className="chat-empty"><Icon as={MessageSquare} size={26}/><p>选择一张子任务卡</p><span>点击「主聊天」，查看进展或补充说明。</span></div>}
  </aside>;
}
