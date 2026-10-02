import React, { useState, useEffect, useRef } from 'react';
import { Overlay, Button, Icon } from './components.jsx';
import { LoaderCircle, Check, ArrowUpRight } from 'lucide-react';
import { call } from './bridge.js';
import { PHASE_NAMES } from './transitions.js';
import { HistoryEvidence } from './history-evidence.jsx';
import { historyProjectPreview } from '../shared/card-layout.js';

export function Proposal({ proposal, data, close, perform, busy, applied }) {
  const [confirmedProgress, setConfirmedProgress] = useState(false);
  const [tasks, setTasks] = useState(() => proposal.result?.tasks?.map((t) => ({ ...t, selected: true })) || []), [criteria, setCriteria] = useState(proposal.result?.criteria?.join('\n') || ''), [assignments, setAssignments] = useState(proposal.result?.assignments?.map((a) => ({ ...a, selected: true })) || []);
  useEffect(() => { setConfirmedProgress(false); if (proposal.status !== 'ready') return; setTasks(proposal.result?.tasks?.map((t) => ({ ...t, selected: true })) || []); setCriteria(proposal.result?.criteria?.join('\n') || ''); setAssignments(proposal.result?.assignments?.map((a) => ({ ...a, selected: true })) || []); }, [proposal.id, proposal.status]);
  const labels = { split: '确认子任务方案', criteria: '确认验收标准草案', question: '项目问答', review: '阶段回顾', history: '确认聊天与卡片方案' };
  const apply = async () => { const args = { id: proposal.id }; if (proposal.type === 'split') args.tasks = tasks.filter((t) => t.selected).map(({ selected, ...t }) => ({ ...t, criteria: t.criteria.map((c) => c.trim()).filter(Boolean) })); if (proposal.type === 'criteria') args.criteria = criteria.split('\n').map((c) => c.trim()).filter(Boolean); if (proposal.type === 'history') { args.assignments = assignments.filter((a) => a.selected).map(({ selected, ...a }) => a); args.confirmProgress = confirmedProgress; } const result = await perform('steward_apply_proposal', args, '已保存你的选择'); if (result) applied(proposal, result); };
  return <Overlay title={labels[proposal.type]} close={close} className="proposal-dialog">
    {proposal.status === 'running' && <><div className="generating"><Icon as={LoaderCircle} className="spin"/><p>Codex 正在拟定建议</p><span>{proposal.type === 'history' ? '可以关闭窗口，稍后从首页「AI 整理现有聊天」继续查看。' : '可以关闭窗口，稍后从项目详情继续查看。'}</span></div><div className="dialog-actions"><Button kind="outline" disabled={busy || !proposal.turnId} onClick={() => perform('steward_cancel_proposal', { id: proposal.id }, '已停止生成')}>停止生成</Button></div></>}
    {proposal.status === 'error' && <p className="inline-error" role="alert">{proposal.error}</p>}
    {proposal.status === 'cancelled' && <p className="setting-note">已停止生成，资料没有变动。</p>}
    {proposal.status === 'ready' && <>
      {proposal.type === 'split' && <><p className="setting-note">挑选需要的子任务，可以修改名称、说明和验收标准。创建后仍需在各小卡确认标准才启动。</p>{tasks.map((task, index) => <section className="proposal-task" key={index}><label className="checkbox-label"><input type="checkbox" checked={task.selected} onChange={(e) => setTasks(tasks.map((t, i) => i === index ? { ...t, selected: e.target.checked } : t))}/>保留此子任务</label><label>名称<input value={task.title} maxLength={240} onChange={(e) => setTasks(tasks.map((t, i) => i === index ? { ...t, title: e.target.value } : t))}/></label><label>说明<textarea value={task.description} onChange={(e) => setTasks(tasks.map((t, i) => i === index ? { ...t, description: e.target.value } : t))}/></label><label>验收标准<textarea value={task.criteria.join('\n')} onChange={(e) => setTasks(tasks.map((t, i) => i === index ? { ...t, criteria: e.target.value.split('\n') } : t))}/></label></section>)}</>}
      {proposal.type === 'criteria' && <><p className="setting-note">检查并编辑草案。保存后，在卡片中勾选确认才允许启动。</p><label>验收标准<textarea className="criteria-text" value={criteria} onChange={(e) => setCriteria(e.target.value)}/></label></>}
      {proposal.type === 'history' && <><p className="setting-note">默认一个聊天一张卡；同一项目有多个独立任务时显示子任务。检查阶段、判断依据与原文，可修改阶段或取消勾选。</p><section className="project-progress-preview" aria-label="项目进度预览"><h3>保存后的项目进度</h3>{historyProjectPreview(assignments, data).map((p) => <div key={p.key}><strong>{p.title || '未命名项目'}</strong><span>{p.single ? '单层卡片' : `${p.count} 个任务`} · {PHASE_NAMES[p.phase]}</span></div>)}<p className="setting-note">单卡沿用自己的阶段；多任务全部结项后，项目进入待验收，由你确认结项。</p></section>{assignments.map((a, index) => {
        const update = (patch) => { setConfirmedProgress(false); setAssignments(assignments.map((v, i) => i === index ? { ...v, ...patch } : v)); };
        return <section className="proposal-task" key={a.chatId}>
          <div className="assignment-heading"><label className="checkbox-label"><input type="checkbox" checked={a.selected} onChange={(e) => update({ selected: e.target.checked })}/>{data.tasks.find((t) => t.id === a.taskId)?.title || a.title}</label><a href={`codex://threads/${encodeURIComponent(a.chatId)}`}>来源聊天<Icon as={ArrowUpRight} size={15}/></a></div>
          <label>卡片阶段<select value={a.phase || 'idea'} onChange={(e) => update({ phase: e.target.value })}>{Object.entries(PHASE_NAMES).map(([phase, label]) => <option key={phase} value={phase} disabled={['review', 'done'].includes(phase) && !a.assessment?.evidence.length}>{label}</option>)}</select></label>
          <HistoryEvidence assessment={a.assessment}/>
          <details className="assignment-settings"><summary>修改归属与任务说明</summary>
            <label>目标项目<select value={a.projectId || ''} onChange={(e) => update({ projectId: e.target.value || null, taskId: null })}><option value="">新建项目</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
            {!a.projectId && <label>新项目名称<input value={a.projectTitle} maxLength={240} onChange={(e) => update({ projectTitle: e.target.value })}/></label>}
            <label>目标卡片<select value={a.taskId || ''} onChange={(e) => update({ taskId: e.target.value || null })}><option value="">新建卡片</option>{data.tasks.filter((t) => t.projectId === a.projectId).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
            {!a.taskId && <><label>任务名称<input value={a.title} maxLength={240} onChange={(e) => update({ title: e.target.value })}/></label><label>任务说明<textarea value={a.description} maxLength={30000} onChange={(e) => update({ description: e.target.value })}/></label></>}
          </details>
        </section>;
      })}<label className="checkbox-label progress-confirmation"><input type="checkbox" checked={confirmedProgress} onChange={(e) => setConfirmedProgress(e.target.checked)}/><span>我已核对所选卡片的阶段与进度依据<small>保存为“已结项”的卡片，表示我已确认当前目标完成。保存进度不会启动聊天。</small></span></label></>}
      {['question', 'review'].includes(proposal.type) && <><div className="answer">{proposal.result.answer}</div><h3>引用来源</h3>{proposal.result.sources.map((s, i) => <div className="source-item" key={i}><strong>[{i + 1}] {data.records.find((r) => r.id === s.recordId)?.title || s.recordId}</strong><p>{s.note}</p></div>)}</>}
      <div className="dialog-actions"><Button kind="outline" onClick={close}>稍后处理</Button><Button kind="primary" disabled={busy || proposal.type === 'split' && !tasks.some((t) => t.selected) || proposal.type === 'criteria' && !criteria.trim() || proposal.type === 'history' && (!confirmedProgress || !assignments.some((a) => a.selected) || assignments.some((a) => a.selected && ((!a.projectId && !a.projectTitle.trim()) || (!a.taskId && !a.title.trim()))))} onClick={apply}>{proposal.type === 'split' ? '确认并创建子任务' : proposal.type === 'history' ? '确认并保存卡片' : '保存到项目'}</Button></div>
    </>}
  </Overlay>;
}

export function ChatPicker({ taskId, projectId, close, perform, busy, propose, proposals = [], projects = [], openProposal }) {
  const [threads, setThreads] = useState([]), [cursor, setCursor] = useState(null), [search, setSearch] = useState(''), [selected, setSelected] = useState(new Set()), [loading, setLoading] = useState(false), [main, setMain] = useState(false), [loadError, setLoadError] = useState(''), [total, setTotal] = useState(null), [excluded, setExcluded] = useState(0), [includeAuxiliary, setIncludeAuxiliary] = useState(false);
  const generation = useRef(0), loadedSearch = useRef('');
  const fetchThreads = async (append = false, showAuxiliary = includeAuxiliary) => {
    const request = ++generation.current, query = append ? loadedSearch.current : search;
    setLoading(true); setLoadError('');
    try {
      const result = await call('steward_chats', { search: query, includeAuxiliary: showAuxiliary, ...(append && cursor ? { cursor } : {}) });
      if (generation.current !== request) return;
      setThreads((previous) => [...new Map([...(append ? previous : []), ...result.threads].map((thread) => [thread.id, thread])).values()]);
      setCursor(result.nextCursor); setTotal(result.total ?? null); setExcluded(result.excludedCount || 0); loadedSearch.current = query;
    } catch (error) { if (generation.current === request) setLoadError(error.message); }
    finally { if (generation.current === request) setLoading(false); }
  };
  useEffect(() => { fetchThreads(); return () => { generation.current++; }; }, []);
  const submit = async () => { if (taskId) { for (const chatId of selected) if (!await perform('steward_chat_attach', { taskId, chatId, main }, '聊天已关联')) return; close(); } else propose(projectId, 'history', undefined, { chatIds: [...selected] }); };
  return <Overlay title={taskId ? '关联已有聊天' : 'AI 整理现有聊天'} close={close}>
    {!taskId && proposals.length > 0 && <section className="history-drafts" aria-label="已有整理建议"><h3>继续查看整理建议</h3>{proposals.map((p) => <button className="history-draft" key={p.id} onClick={() => openProposal(p.id)}><span>{projects.find((project) => project.id === p.projectId)?.title || '现有聊天整理'} · {p.selectedChatIds.length} 个聊天</span><small>{({ running: '正在生成', ready: '待确认', error: '生成失败' })[p.status]}</small></button>)}</section>}
    <form className="chat-search" onSubmit={(e) => { e.preventDefault(); fetchThreads(); }}><input aria-label="搜索已有聊天" placeholder="搜索聊天标题…" value={search} onChange={(e) => setSearch(e.target.value)}/><Button kind="outline" disabled={loading}>搜索</Button><Button kind="text" type="button" disabled={loading} onClick={() => fetchThreads()}>刷新</Button></form>
    <p className="setting-note">{taskId ? '选择要关联的任务聊天。' : 'AI 会建议卡片、项目分组和当前进度，确认后才保存；默认一张卡，需要时再拆子任务。'}只整理你勾选的聊天，每次最多 30 个；列表只显示 workspace 项目中的聊天。</p>
    <div className="chat-list-summary"><span>{total === null ? `已显示 ${threads.length} 条` : `已显示 ${threads.length} / ${total} 条`} · 已选 {selected.size}</span><label className="checkbox-label"><input type="checkbox" checked={includeAuxiliary} disabled={loading} onChange={(e) => { setIncludeAuxiliary(e.target.checked); fetchThreads(false, e.target.checked); }}/>显示整理辅助聊天</label></div>
    {excluded > 0 && <p className="setting-note">另有 {excluded} 个插件整理辅助聊天已隐藏，可勾选上方选项查看。</p>}
    {loadError && <p className="inline-error" role="alert">{loadError}</p>}
    <div className="chat-picker">{threads.map((t) => <label className="chat-option" key={t.id}><input type={main ? 'radio' : 'checkbox'} checked={selected.has(t.id)} onChange={(e) => { const next = main ? new Set() : new Set(selected); if (e.target.checked) next.add(t.id); else next.delete(t.id); setSelected(next); }}/><span>{t.title}</span></label>)}</div>
    {loading && <p className="setting-note">正在读取聊天列表…</p>}{!loading && !loadError && !threads.length && <p className="setting-note">没有找到聊天。可更换搜索词；如果还没有聊天，也可以关闭窗口后新建卡片。</p>}
    {cursor && <Button kind="text" disabled={loading} onClick={() => fetchThreads(true)}>加载更多</Button>}
    {taskId && <label className="checkbox-label"><input type="checkbox" checked={main} onChange={(e) => { setMain(e.target.checked); setSelected(new Set()); }}/>作为主聊天（仅限尚未执行的卡片）</label>}
    <div className="dialog-actions"><Button kind="outline" onClick={close}>取消</Button><Button kind="primary" disabled={busy || selected.size < 1 || selected.size > 30} onClick={submit}>{taskId ? '确认关联' : 'AI 归类并生成卡片建议'}</Button></div>
  </Overlay>;
}
