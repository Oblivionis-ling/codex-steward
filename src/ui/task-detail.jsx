import React, { useState } from 'react';
import { Check, Sparkles, MessageSquare } from 'lucide-react';
import { Overlay, Button, Icon } from './components.jsx';
import { PHASE_NAMES, EXEC_NAMES } from './board.jsx';

export function TaskDetail({ task, project, data, initialTab = 'description', close, perform, busy, propose, openChat, notify, demo }) {
  const [tab, setTab] = useState(initialTab || 'description'), [title, setTitle] = useState(task.title), [description, setDescription] = useState(task.description), [criteria, setCriteria] = useState(task.criteria.join('\n')), [confirmed, setConfirmed] = useState(!!task.confirmedHash), [feedback, setFeedback] = useState('');
  const executing = ['starting', 'running', 'stopping'].includes(task.execution) || data.activeTaskIds?.includes(task.id);
  const locked = executing || task.phase === 'done';
  const changed = title !== task.title || description !== task.description || criteria !== task.criteria.join('\n');
  const edit = (setter, value) => { setter(value); setConfirmed(false); };
  const save = () => perform('steward_task_update', { id: task.id, title, description, criteria: criteria.split('\n').map((c) => c.trim()).filter(Boolean) }, '任务说明已保存');
  const confirm = async () => {
    if (changed && !await save()) return;
    if (!confirmed) { notify('请先确认验收标准。'); return; }
    if (!task.confirmedHash || changed) { if (!await perform('steward_task_confirm', { id: task.id })) return; }
    return true;
  };
  const start = async () => { if (!await confirm()) return; const result = await perform('steward_task_start', { id: task.id, ...(task.phase === 'review' ? { feedback } : {}) }, '任务已发送到主聊天'); if (result) openChat(task.id); };
  return <Overlay title={task.title} subtitle={`项目：${project.title}`} close={close} className="drawer task-drawer"><div className="drawer-body">
    <div className="detail-tabs" role="tablist">{Object.entries({ description: '任务说明', acceptance: '验收与成果', materials: '资料' }).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}<button onClick={() => openChat(task.id)}><Icon as={MessageSquare} size={14}/>主聊天</button></div>
    <div className="task-detail-status"><span className={`phase-label ${task.phase}`}>{PHASE_NAMES[task.phase]}</span><span>{EXEC_NAMES[task.execution]}</span></div>
    {task.error && <p className={`inline-error ${task.execution === 'blocked' ? 'blocked-text' : ''}`} role="alert">{task.error}</p>}
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
    {tab === 'materials' && <><h3>项目资料</h3>{data.records.filter((r) => r.projectId === project.id && !r.hidden).map((r) => <article className="material-row" key={r.id}><h4>{r.title}</h4><p>{r.summary || r.content}</p>{r.sourceChatId && <a href={`codex://threads/${encodeURIComponent(r.sourceChatId)}`}>查看来源聊天</a>}</article>)}{!data.records.some((r) => r.projectId === project.id && !r.hidden) && <p className="setting-note">主聊天交付的精选成果与关键决定会保存在项目资料中。</p>}</>}
    </div><footer className="drawer-footer"><span className="setting-note">拖动看板卡片推进或回退</span><div>
      {task.phase === 'ready' && <Button kind="primary" disabled={busy || locked || !confirmed || demo} onClick={async () => { if (await confirm()) { notify('标准已确认，把小卡拖到进行中即可执行。'); close(); } }}>保存并确认标准</Button>}
      {task.phase === 'review' && <Button kind="outline" disabled={busy || !feedback.trim() || demo} onClick={start}>发送意见并返工</Button>}
      {task.phase === 'active' && !executing && <Button kind="primary" disabled={busy || !confirmed || demo} onClick={start}>继续执行</Button>}
      {task.phase === 'done' && <span className="setting-note">已结项</span>}
    </div></footer></Overlay>;
}
