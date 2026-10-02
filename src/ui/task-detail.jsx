import React, { useState, useEffect } from 'react';
import { Check, Sparkles, ArrowLeft, ArrowUpRight, LoaderCircle, Plus } from 'lucide-react';
import { Overlay, Button, Icon } from './components.jsx';
import { PHASES, PHASE_NAMES, EXEC_NAMES } from './board.jsx';
import { call, isEmbedded, openLink } from './bridge.js';

export function TaskDetail({ task, project, data, initialTab = 'description', close, perform, busy, propose, attach, notify, demo }) {
  const [tab, setTab] = useState(initialTab), [title, setTitle] = useState(task.title), [description, setDescription] = useState(task.description), [criteria, setCriteria] = useState(task.criteria.join('\n')), [confirmed, setConfirmed] = useState(!!task.confirmedHash), [feedback, setFeedback] = useState(''), [message, setMessage] = useState(''), [history, setHistory] = useState(null);
  const executing = ['starting', 'running', 'stopping'].includes(task.execution) || data.activeTaskIds?.includes(task.id);
  const locked = executing || task.phase === 'done';
  useEffect(() => { if (tab !== 'chat' || !task.mainChatId) return; let active = true; const read = async () => { try { const result = demo ? { messages: [], status: { type: 'idle' } } : await call('steward_chat_history', { taskId: task.id }); if (active) setHistory(result); } catch (error) { if (active) setHistory({ error: error.message }); } }; read(); const timer = setInterval(read, 4000); return () => { active = false; clearInterval(timer); }; }, [tab, task.id, task.mainChatId, demo]);
  const changed = title !== task.title || description !== task.description || criteria !== task.criteria.join('\n');
  const edit = (setter, value) => { setter(value); setConfirmed(false); };
  const save = () => perform('steward_task_update', { id: task.id, title, description, criteria: criteria.split('\n').map((c) => c.trim()).filter(Boolean) }, '任务说明已保存');
  const start = async () => {
    if (changed && !await save()) return;
    if (!confirmed) { notify('请先确认验收标准。'); return; }
    if (!task.confirmedHash || changed) { if (!await perform('steward_task_confirm', { id: task.id })) return; }
    const result = await perform('steward_task_start', { id: task.id, ...(task.phase === 'review' ? { feedback } : {}) }, '任务已发送到主聊天');
    if (result?.url && isEmbedded()) { try { await openLink(result.url); } catch (error) { notify(`执行已启动，打开主聊天失败：${error.message}`); } }
  };
  const index = PHASES.indexOf(task.phase);
  return <Overlay title={task.title} subtitle={`项目：${project.title}`} close={close} className="drawer task-drawer"><div className="drawer-body">
    <div className="detail-tabs" role="tablist">{Object.entries({ description: '任务说明', acceptance: '验收与成果', chat: '主聊天', materials: '资料' }).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="task-detail-status"><span className={`phase-label ${task.phase}`}>{PHASE_NAMES[task.phase]}</span><span>{EXEC_NAMES[task.execution]}</span></div>
    {task.error && <p className="inline-error" role="alert">{task.error}</p>}
    {tab === 'description' && <><label>任务名称<input value={title} maxLength={240} disabled={locked} onChange={(e) => edit(setTitle, e.target.value)}/></label><label>任务说明<textarea className="goal-text" value={description} maxLength={30000} disabled={locked} placeholder="目标、工作范围与预期交付…" onChange={(e) => edit(setDescription, e.target.value)}/></label><Button disabled={busy || locked || !title.trim()} onClick={save}>保存说明</Button><p className="setting-note">启动时使用这里保存的说明与已确认的验收标准。</p></>}
    {tab === 'acceptance' && <>
      <p className="setting-note">{task.phase === 'ready' ? '确认验收标准后即可开始。' : task.phase === 'review' ? '检查交付证据，通过后结项；需要调整时填写修改意见。' : task.progress || '先拟定验收标准，再推进任务。'}</p>
      <div className="section-heading"><h3>验收标准</h3><Button kind="text" disabled={busy || locked} onClick={async () => { if (changed && !await save()) return; propose(project.id, 'criteria', task.id); }}><Icon as={Sparkles} size={16}/>AI 拟定</Button></div>
      <textarea className="criteria-text" aria-label="验收标准" value={criteria} disabled={locked} placeholder="每行一条可验证的标准…" onChange={(e) => edit(setCriteria, e.target.value)}/>
      <p className="setting-note">由 AI 拟定，可编辑后确认</p>
      <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={locked || !criteria.trim()} onChange={(e) => setConfirmed(e.target.checked)}/>我已确认以上验收标准</label>
      <h3>交付成果</h3>{task.delivery ? <div className="delivery">{!task.deliveryHash && <p className="setting-note">保留的历史成果；本轮需重新交付后验收。</p>}<p>{task.delivery.summary}</p>{task.delivery.checks.map((check, i) => <div className="evidence" key={i}><strong><Icon as={Check} size={15}/>{check.criterion}</strong><p>{check.evidence}</p></div>)}</div> : <div className="empty-delivery">尚未交付成果</div>}
      <label className="feedback-label">修改意见<textarea value={feedback} maxLength={10000} placeholder="写下需要调整的地方…" onChange={(e) => setFeedback(e.target.value)}/></label>
    </>}
    {tab === 'chat' && <>
      <div className="section-heading"><h3>主聊天</h3><Button kind="text" disabled={!task.mainChatId || demo} onClick={async () => { if (isEmbedded()) await openLink(`codex://threads/${encodeURIComponent(task.mainChatId)}`); else notify('请使用下方链接在 Codex 中打开。'); }}><Icon as={ArrowUpRight} size={16}/>打开主聊天</Button></div>
      {task.mainChatId && !isEmbedded() && !demo && <a className="native-link" href={`codex://threads/${encodeURIComponent(task.mainChatId)}`}>在 Codex 中打开此聊天</a>}
      {!task.mainChatId ? <div className="empty-delivery">启动后自动建立主聊天</div> : history?.error ? <p className="inline-error">{history.error}</p> : !history ? <p className="setting-note">正在读取真实聊天…</p> : <div className="chat-transcript">{history.messages.length ? history.messages.map((m) => <article key={m.id} className={`chat-message ${m.role}`}><strong>{m.role === 'user' ? '你' : 'Codex'}</strong><p>{m.text}</p></article>) : <p className="setting-note">{demo ? '只读示例；真实聊天会显示在这里。' : '还没有聊天消息。'}</p>}</div>}
      {task.mainChatId && task.phase !== 'done' && <form onSubmit={async (e) => { e.preventDefault(); if (await perform('steward_chat_send', { taskId: task.id, message }, '消息已发送')) setMessage(''); }}><label>继续主聊天<textarea value={message} maxLength={10000} placeholder="补充说明或回答 Codex…" onChange={(e) => setMessage(e.target.value)}/></label><Button kind="primary" disabled={busy || !message.trim() || demo}>发送</Button></form>}
      <div className="section-heading"><h3>关联聊天</h3><Button kind="text" disabled={busy || demo} onClick={() => attach(task.id)}><Icon as={Plus} size={16}/>关联已有聊天</Button></div>
      {task.relatedChatIds.length ? task.relatedChatIds.map((chatId) => <a className="native-link" key={chatId} href={`codex://threads/${encodeURIComponent(chatId)}`}>关联聊天 {chatId.slice(0, 8)}<Icon as={ArrowUpRight} size={15}/></a>) : <p className="setting-note">可添加其他聊天作为参考，主聊天跨阶段沿用。</p>}
    </>}
    {tab === 'materials' && <><h3>项目资料</h3>{data.records.filter((r) => r.projectId === project.id && !r.hidden).map((r) => <article className="material-row" key={r.id}><h4>{r.title}</h4><p>{r.summary || r.content}</p>{r.sourceChatId && <a href={`codex://threads/${encodeURIComponent(r.sourceChatId)}`}>查看来源聊天</a>}</article>)}{!data.records.some((r) => r.projectId === project.id && !r.hidden) && <p className="setting-note">主聊天交付的精选成果与关键决定会保存在项目资料中。</p>}</>}
    </div><footer className="drawer-footer"><div>{index > 0 && <Button kind="outline" disabled={busy || task.execution === 'starting' || task.execution === 'stopping' || demo} onClick={() => perform('steward_task_move', { id: task.id, phase: PHASES[index - 1] }, '小卡已回退')}><Icon as={ArrowLeft} size={16}/>退回</Button>}</div><div>
      {task.phase === 'idea' && <Button kind="primary" disabled={busy || demo} onClick={() => perform('steward_task_move', { id: task.id, phase: 'ready' }, '小卡已进入待启动')}>推进到待启动</Button>}
      {task.phase === 'ready' && <Button kind="primary" disabled={busy || locked || !confirmed || demo} onClick={start}>{task.execution === 'starting' ? '正在启动…' : '开始执行'}</Button>}
      {task.phase === 'review' && <><Button kind="outline" disabled={busy || !feedback.trim() || demo} onClick={start}>发送意见并返工</Button><Button kind="primary" disabled={busy || demo || changed || !task.deliveryHash} onClick={() => perform('steward_task_move', { id: task.id, phase: 'done' }, '验收通过，小卡已结项')}>验收通过</Button></>}
      {task.phase === 'active' && !executing && <Button kind="primary" disabled={busy || !confirmed || demo} onClick={start}>继续执行</Button>}
      {task.phase === 'done' && <span className="setting-note">已结项</span>}
    </div></footer></Overlay>;
}
