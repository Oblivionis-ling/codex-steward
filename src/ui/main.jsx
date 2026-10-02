import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Settings, ChevronUp, LoaderCircle, CircleAlert, Moon, Sun, MessageSquare, X } from 'lucide-react';
import { Board, needsAttention } from './board.jsx';
import { dropIntent, PHASE_NAMES } from './transitions.js';
import { ChatDock } from './chat-dock.jsx';
import { ChatRecovery } from './chat-recovery.jsx';
import { MoveConfirmation } from './move-confirmation.jsx';
import { TaskDetail } from './task-detail.jsx';
import { ProjectDetail, NewItem, Rollback, MaterialEdit } from './project-detail.jsx';
import { Proposal, ChatPicker } from './proposals.jsx';
import { NativeRequest } from './native-requests.jsx';
import { Icon, Button, Overlay, ModelSettings } from './components.jsx';
import { load, call, localValue, saveLocalValue, sendAI, isEmbedded, openLink } from './bridge.js';
import { demo } from './demo.js';
import { isSingleProject } from '../shared/card-layout.js';
import './styles.css';

const isDemo = new URLSearchParams(location.search).get('demo') === '1';
function App() {
  const [data, setData] = useState(isDemo ? demo : null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [expanded, setExpanded] = useState(isDemo ? 'steward' : localValue('expanded') || null), [overlay, setOverlay] = useState(null), [toast, setToast] = useState(''), [theme, setTheme] = useState(localValue('theme', 'light')), [apiKey, setApiKey] = useState(localValue('key'));
  const previous = useRef(null), toastTimer = useRef(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(localValue('welcome-dismissed') === '1');
  const [chatTaskId, setChatTaskId] = useState(null), [chatVisible, setChatVisible] = useState(localValue('chat-visible', matchMedia('(min-width:960px)').matches ? '1' : '0') === '1');
  const showChat = (id) => { setChatTaskId(id); setChatVisible(true); saveLocalValue('chat-visible', '1'); };
  const hideChat = () => { setChatVisible(false); saveLocalValue('chat-visible', '0'); };
  const notify = (message) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6500); };
  const receive = (next) => {
    if (previous.current) { const old = new Map(previous.current.tasks.map((t) => [t.id, t])); const actionable = next.tasks.find((t) => needsAttention(t) && !needsAttention(old.get(t.id) || { execution: 'idle', phase: 'idea' })); if (actionable) notify(`${actionable.title}：${actionable.execution === 'blocked' ? '聊天被占用' : actionable.phase === 'review' ? '待验收' : actionable.execution === 'failed' ? '执行失败' : '等你处理'}`); }
    previous.current = next; setData(next); setError('');
  };
  const refresh = async () => { if (isDemo) return demo; const next = await call('steward_state'); receive(next); return next; };
  useEffect(() => { if (isDemo) return; let alive = true; load().then((next) => { if (alive) receive(next); }).catch((e) => { if (alive) setError(e.message); }); const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch((e) => setError(e.message)); }, 3000); const state = (e) => receive(e.detail); window.addEventListener('steward:state', state); return () => { alive = false; clearInterval(timer); clearTimeout(toastTimer.current); window.removeEventListener('steward:state', state); }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const perform = async (name, args = {}, success) => { if (isDemo) { notify('这是只读演示，请打开实际数据页面操作。'); return null; } setBusy(true); try { const result = await call(name, args); await refresh(); if (result.blocked) notify(result.message); else if (success) notify(success); return result; } catch (e) { await refresh().catch(() => {}); notify(e.message); return null; } finally { setBusy(false); } };
  const expand = (id) => { setExpanded(id); saveLocalValue('expanded', id || ''); };
  const openTask = (id, tab) => { const task = previous.current?.tasks.find((t) => t.id === id) || data.tasks.find((t) => t.id === id); if (task) { expand(task.projectId); setChatTaskId(id); } if (tab === 'chat') { setOverlay(null); showChat(id); } else setOverlay({ type: 'task', id, tab }); };
  const moveCard = async (original, kind, phase) => {
    const item = (kind === 'project' ? data.projects : data.tasks).find((card) => card.id === original.id);
    if (!item || item.phase !== original.phase) { notify('卡片阶段已变化，请重新拖动。'); return; }
    const intent = dropIntent(item, kind, phase, data);
    if (!intent.allowed) { notify(intent.reason); return; }
    if (intent.action === 'criteria') { notify('请确认任务说明和验收标准，再拖入进行中。'); openTask(item.id, 'acceptance'); return; }
    if (intent.action === 'rollbackProject') { setOverlay({ type: 'rollback', id: item.id, expectedPhase: item.phase }); return; }
    if (['rollbackTask', 'acceptTask', 'acceptProject'].includes(intent.action)) { setOverlay({ type: 'move-confirmation', id: item.id, kind, phase, action: intent.action, itemSnapshot: item }); return; }
    const result = await perform(kind === 'project' ? 'steward_project_move' : 'steward_task_move', { id: item.id, phase, expectedPhase: item.phase }, `已进入${PHASE_NAMES[phase]}`);
    if (result && intent.action === 'start') showChat(item.id);
    requestAnimationFrame(() => document.querySelector(`[data-card-id="${kind}:${item.id}"] .drag-handle`)?.focus());
  };
  const propose = async (projectId, type, taskId, extra = {}) => { if (extra.proposalId) { setOverlay({ type: 'proposal', id: extra.proposalId }); return; } const result = await perform('steward_propose', { projectId, type, ...(taskId ? { taskId } : {}), ...extra }); if (result) setOverlay({ type: 'proposal', id: result.proposal.id }); };
  const archive = async (selected) => { const records = Array.isArray(selected) ? selected : [selected]; const prepared = await perform('steward_prepare_ai', { type: 'archive', ids: records.map((r) => r.id) }); if (!prepared) return; if (data.settings.mode === 'api') await perform('steward_run_ai', { jobId: prepared.job.id, provider: { ...data.settings, apiKey } }, '资料正在整理'); else { try { await sendAI(prepared, data.workspace); notify('归档请求已发送给 Codex'); } catch (e) { notify(e.message); await perform('steward_finish_job', { jobId: prepared.job.id, error: e.message }); } } };
  const item = overlay?.type === 'task' ? data?.tasks.find((t) => t.id === overlay.id) : overlay?.type === 'project' || overlay?.type === 'rollback' ? data?.projects.find((p) => p.id === overlay.id) : overlay?.type === 'proposal' ? data?.proposals.find((p) => p.id === overlay.id) : null;
  const close = () => setOverlay(null), attention = data?.tasks.filter(needsAttention) || [], requests = data?.pendingRequests || [];
  const attentionCount = attention.length + requests.filter((r) => !attention.some((t) => t.mainChatId === r.threadId)).length;
  const attentionClick = () => { if (requests[0]) setOverlay({ type: 'request', id: requests[0].id }); else if (attention[0]) openTask(attention[0].id, attention[0].phase === 'review' ? 'acceptance' : 'chat'); };
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; saveLocalValue('theme', next); setTheme(next); };
  const dismissWelcome = () => { setWelcomeDismissed(true); saveLocalValue('welcome-dismissed', '1'); };
  const openHistory = () => { dismissWelcome(); setOverlay({ type: 'chats' }); };
  const historyProposals = data?.proposals.filter((p) => p.type === 'history' && ['running', 'ready', 'error'].includes(p.status)) || [];
  const chatTask = data?.tasks.find((t) => t.id === chatTaskId);
  const expandedGroup = data?.projects.find((p) => p.id === expanded && !isSingleProject(data, p));
  const moveItem = overlay?.type === 'move-confirmation' ? (overlay.kind === 'project' ? data.projects : data.tasks).find((card) => card.id === overlay.id) : null;
  return <div className="app-shell" data-embedded={isEmbedded()} onClick={(event) => { const link = event.target.closest('a[href^="codex://"]'); if (!link) return; if (isDemo || isEmbedded()) { event.preventDefault(); if (isDemo) notify('只读演示中的聊天为示例。'); else openLink(link.getAttribute('href')).catch((e) => notify(e.message)); } }}><header className="topbar"><div className="brand"><h1>任务看板</h1></div><div className="top-actions"><label className="search-box"><Icon as={Search} size={17}/><input aria-label="搜索项目或任务" placeholder="搜索项目或任务" value={search} onChange={(e) => setSearch(e.target.value)}/></label><Button kind="outline" className="history-button" disabled={isDemo || !data} onClick={openHistory}><Icon as={MessageSquare} size={16}/>AI 整理现有聊天</Button><Button kind="outline" onClick={() => setOverlay({ type: 'settings' })}><Icon as={Settings} size={16}/>设置</Button><Button kind="primary" disabled={busy || isDemo} onClick={() => setOverlay({ type: 'new-card' })}><Icon as={Plus} size={16}/>新建卡片</Button></div></header>
    <div className="board-toolbar"><div>{expandedGroup ? <>已展开：<strong>{expandedGroup.title}</strong></> : <span>拖到相邻栏切换阶段 · 需要时再拆分子任务</span>}{isDemo && <span className="demo-label">只读演示</span>}</div><div className="toolbar-right">{attentionCount > 0 && <button className="attention-button" onClick={attentionClick}><Icon as={CircleAlert} size={16}/>{attentionCount} 项需要处理</button>}{expandedGroup && <button className="text-button collapse-button" onClick={() => expand(null)}>收起<Icon as={ChevronUp} size={15}/></button>}<button className="text-button" aria-pressed={chatVisible} onClick={() => chatVisible ? hideChat() : showChat(chatTaskId)}><Icon as={MessageSquare} size={15}/>{chatVisible ? '收起聊天' : '任务聊天'}</button></div></div>
    {error && <div className="load-error" role="alert">{error}<Button kind="outline" onClick={() => refresh().catch((e) => setError(e.message))}>重试</Button></div>}
    {data ? <div className="workspace-grid"><div className="board-content"><Board data={data} expanded={expanded} expand={expand} openProject={(id, tab) => setOverlay({ type: 'project', id, tab })} openTask={openTask} openChat={showChat} moveCard={moveCard} busy={busy || isDemo} search={search}/>{!data.projects.length && !welcomeDismissed && !overlay && <aside className="board-onboarding" aria-label="看板入门"><button className="icon-button welcome-close" aria-label="关闭入门引导" onClick={dismissWelcome}><Icon as={X} size={20}/></button><h2>整理已有聊天，或新建卡片</h2><p>勾选已有聊天，让 AI 建议卡片与进度；默认一个聊天一张卡，需要时再拆子任务。</p><div className="welcome-actions"><Button kind="primary" onClick={openHistory}><Icon as={MessageSquare} size={18}/>整理现有聊天</Button><Button kind="outline" onClick={() => setOverlay({ type: 'new-card' })}><Icon as={Plus} size={18}/>新建卡片</Button></div><Button kind="text" onClick={dismissWelcome}>暂时跳过</Button></aside>}</div>{chatVisible && <ChatDock key={chatTask?.id || 'empty'} task={chatTask} tasks={data.tasks} project={data.projects.find((p) => p.id === chatTask?.projectId)} select={showChat} close={hideChat} perform={perform} busy={busy} notify={notify} configure={(id) => openTask(id, 'acceptance')} recover={(task) => setOverlay({ type: 'chat-recovery', taskSnapshot: task })} attach={(taskId) => setOverlay({ type: 'chats', taskId })} request={requests.find((r) => r.threadId === chatTask?.mainChatId)} openRequest={(id) => setOverlay({ type: 'request', id })} demo={isDemo}/>}</div> : !error && <div className="loading"><Icon as={LoaderCircle} className="spin"/>正在打开看板…</div>}
    {overlay?.type === 'new-card' && <NewItem kind="card" close={close} perform={perform} busy={busy} created={(r) => openTask(r.task.id)}/>}
    {overlay?.type === 'new-task' && <NewItem kind="task" projectId={overlay.projectId} close={close} perform={perform} busy={busy} created={(r) => openTask(r.task.id)}/>}
    {overlay?.type === 'chat-recovery' && <ChatRecovery task={overlay.taskSnapshot} close={close} perform={perform} busy={busy} done={(id) => { close(); showChat(id); }}/>}
    {overlay?.type === 'task' && item && <TaskDetail key={JSON.stringify([item.id, overlay.tab])} task={item} project={data.projects.find((p) => p.id === item.projectId)} data={data} initialTab={overlay.tab} close={close} perform={perform} busy={busy} propose={propose} openChat={(id) => { close(); showChat(id); }} openProject={(id, tab) => setOverlay({ type: 'project', id, tab })} notify={notify} demo={isDemo}/>}
    {overlay?.type === 'project' && item && <ProjectDetail key={JSON.stringify([item.id, overlay.tab])} project={item} data={data} initialTab={overlay.tab} close={close} perform={perform} busy={busy} propose={propose} openTask={openTask} newTask={(projectId) => setOverlay({ type: 'new-task', projectId })} rollback={(p) => setOverlay({ type: 'rollback', id: p.id })} history={(projectId) => setOverlay({ type: 'chats', projectId })} material={(id, projectId) => setOverlay({ type: 'material', id, projectId })} archive={archive} demo={isDemo}/>}
    {overlay?.type === 'rollback' && item && <Rollback project={item} expectedPhase={overlay.expectedPhase} tasks={data.tasks} close={close} perform={perform} busy={busy} done={() => { expand(item.id); close(); }}/>}
    {overlay?.type === 'move-confirmation' && moveItem && <MoveConfirmation item={overlay.itemSnapshot} kind={overlay.kind} phase={overlay.phase} action={overlay.action} close={close} perform={perform} busy={busy} done={close}/>}
    {overlay?.type === 'proposal' && item && <Proposal proposal={item} data={data} close={close} perform={perform} busy={busy} applied={(p, result) => { if (p.type === 'history') { expand(result.projectIds[0]); close(); } else if (p.taskId) openTask(p.taskId, 'acceptance'); else { expand(p.projectId); setOverlay({ type: 'project', id: p.projectId }); } }}/>}
    {overlay?.type === 'chats' && <ChatPicker taskId={overlay.taskId} projectId={overlay.projectId} close={close} perform={perform} busy={busy} propose={propose} notify={notify} proposals={historyProposals} projects={data?.projects || []} openProposal={(id) => setOverlay({ type: 'proposal', id })}/>}
    {overlay?.type === 'material' && <MaterialEdit record={data.records.find((r) => r.id === overlay.id)} projectId={overlay.projectId} close={close} perform={perform} busy={busy}/>}
    {overlay?.type === 'request' && requests.find((r) => r.id === overlay.id) && <NativeRequest request={requests.find((r) => r.id === overlay.id)} close={close} perform={perform} busy={busy}/>}
    {overlay?.type === 'settings' && <Overlay title="设置" close={close}><div className="settings-section"><h3>外观</h3><Button kind="outline" onClick={toggleTheme}><Icon as={theme === 'dark' ? Sun : Moon} size={18}/>{theme === 'dark' ? '切换浅色主题' : '切换深色主题'}</Button></div><div className="settings-section"><h3>Codex 连接</h3><p>任务执行、拆分与问答使用本机已有 Codex 登录。</p><Button kind="outline" disabled={busy || isDemo} onClick={async () => { const result = await perform('steward_codex_status'); if (result) notify(result.connected && result.authenticated ? 'Codex 已连接，登录可用' : result.error || '请先在 Codex 登录后重试。'); }}>检查连接</Button></div><div className="settings-section"><h3>资料整理与数据备份</h3><p>资料归档可使用自己的模型。备份包含项目、小卡、资料与聊天关联。</p><Button kind="outline" onClick={() => setOverlay({ type: 'model-settings' })}>模型与备份设置</Button></div><div className="setting-note version-note">个人管家 0.2.3 开发版 · 本地保存</div></Overlay>}
    {overlay?.type === 'model-settings' && data && <ModelSettings settings={data.settings} apiKey={apiKey} setKey={(value) => { setApiKey(value); if (!saveLocalValue('key', value)) notify('当前界面无法持久保存 Key，本次打开仍可使用。'); }} close={close} save={(settings) => perform('steward_settings', settings, '设置已保存')} exportData={async () => { const result = await perform('steward_export'); if (result) notify(`备份已保存：${result.filePath}`); }} importData={async (file) => { try { await perform('steward_import', { data: JSON.parse(await file.text()) }, '备份已合并'); } catch (e) { notify(`导入失败：${e.message}`); } }} storagePath={data.storagePath}/>}
    {toast && <div className="toast" role="status">{toast}<button aria-label="关闭提示" onClick={() => setToast('')}>×</button></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
