import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, GripVertical } from 'lucide-react';
import { Icon, Button } from './components.jsx';
import { PHASES, PHASE_NAMES, dropIntent } from './transitions.js';
import { isSingleProject } from '../shared/card-layout.js';

export { PHASES, PHASE_NAMES } from './transitions.js';
export const EXEC_NAMES = { idle: '', starting: '正在启动', running: '运行中', waiting: '等你处理', failed: '执行失败', stopping: '正在停止', blocked: '聊天被占用' };
export const needsAttention = (task) => task.phase === 'review' || ['waiting', 'failed', 'blocked'].includes(task.execution);

export function Board({ data, expanded, expand, openProject, openTask, openChat, moveCard, busy, search }) {
  const [dragging, setDragging] = useState(null), session = useRef(null), board = useRef(null);
  const query = search.trim().toLocaleLowerCase();
  const projects = data.projects.filter((p) => !query || `${p.title} ${p.goal}`.toLocaleLowerCase().includes(query) || data.tasks.some((t) => t.projectId === p.id && `${t.title} ${t.description}`.toLocaleLowerCase().includes(query)));
  const singleIds = new Set(projects.filter((p) => isSingleProject(data, p)).map((p) => p.id));
  const groups = projects.filter((p) => !singleIds.has(p.id));
  const children = data.tasks.filter((t) => (singleIds.has(t.projectId) || t.projectId === expanded) && (!query || `${t.title} ${t.description}`.toLocaleLowerCase().includes(query) || singleIds.has(t.projectId) && `${projects.find((p) => p.id === t.projectId).title} ${projects.find((p) => p.id === t.projectId).goal}`.toLocaleLowerCase().includes(query)));
  const cancel = () => { session.current = null; setDragging(null); };
  const commit = (current) => {
    cancel();
    if (current?.moved && current.target && current.target !== current.item.phase) moveCard(current.item, current.kind, current.target);
  };
  const pointerDown = (event, item, kind) => {
    if (busy || event.button !== 0) return;
    session.current = { item, kind, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, target: item.phase };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event) => {
    const current = session.current;
    if (!current || current.keyboard) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    event.preventDefault();
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-phase]');
    const rect = board.current.getBoundingClientRect();
    if (event.clientX < rect.left + 28) board.current.scrollLeft -= 18;
    if (event.clientX > rect.right - 28) board.current.scrollLeft += 18;
    Object.assign(current, { moved: true, x: event.clientX, y: event.clientY, target: lane?.dataset.phase || null });
    setDragging({ ...current });
  };
  const keyboard = (event, item, kind) => {
    if (session.current && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (busy) return;
    if (!session.current && [' ', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      session.current = { item, kind, keyboard: true, moved: true, target: item.phase };
      setDragging({ ...session.current }); return;
    }
    const current = session.current;
    if (!current?.keyboard || current.item.id !== item.id) return;
    if (!['Escape', 'Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.key === 'Tab') { cancel(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') cancel();
    else if (['Enter', ' '].includes(event.key)) commit(current);
    else { const index = PHASES.indexOf(current.target) + (event.key === 'ArrowRight' ? 1 : -1); current.target = PHASES[Math.max(0, Math.min(4, index))]; setDragging({ ...current }); }
  };
  const handle = (item, kind) => <button className="drag-handle" aria-label={`拖动${kind === 'project' ? '项目' : '任务'}：${item.title}`} aria-describedby="drag-help" disabled={busy || !!(kind === 'project' ? item.transitionId : data.projects.find((p) => p.id === item.projectId)?.transitionId) || ['starting', 'stopping'].includes(item.execution)} onPointerDown={(e) => pointerDown(e, item, kind)} onPointerMove={pointerMove} onPointerUp={() => commit(session.current)} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={(e) => keyboard(e, item, kind)} onBlur={() => { if (session.current?.keyboard) cancel(); }} title="拖动到相邻栏；也可按空格、方向键、回车"><Icon as={GripVertical} size={15}/></button>;
  const intent = dragging?.target && dropIntent(dragging.item, dragging.kind, dragging.target, data);
  return <main ref={board} className={`board ${dragging ? 'is-dragging' : ''}`} aria-label="五栏任务看板">
    <span id="drag-help" className="sr-only">拖动手柄到相邻栏。键盘：空格拿起，左右键选择，回车放下，Escape 取消。</span>
    <span className="sr-only" role="status" aria-live="polite">{dragging && `${dragging.item.title}，${PHASE_NAMES[dragging.target] || '看板外'}。${intent?.reason || '移到目标栏后放下。'}`}</span>
    {PHASES.map((phase) => {
    const big = groups.filter((p) => p.phase === phase), small = children.filter((t) => t.phase === phase);
    const selected = dragging?.target === phase && dragging.item.phase !== phase;
    return <section className={`lane ${selected ? intent?.allowed ? 'drop-allowed' : 'drop-blocked' : ''}`} data-phase={phase} key={phase} aria-label={PHASE_NAMES[phase]}><header className="lane-header"><h2>{PHASE_NAMES[phase]}</h2><span aria-label="卡片数量">{big.length + small.length}</span></header>
      {selected && <p className="drop-hint">{intent.reason}</p>}
      <div className="lane-cards">{big.map((project) => { const tasks = data.tasks.filter((t) => t.projectId === project.id); return <article className={`project-card ${expanded === project.id ? 'expanded' : ''} ${dragging?.item.id === project.id ? 'card-dragging' : ''}`} data-card-id={`project:${project.id}`} key={project.id}>
        {handle(project, 'project')}<button className="disclosure icon-button" aria-label={`${expanded === project.id ? '收起' : '展开'}：${project.title}`} aria-expanded={expanded === project.id} onClick={() => expand(expanded === project.id ? null : project.id)}><Icon as={expanded === project.id ? ChevronDown : ChevronRight} size={15}/></button>
        <button className="project-copy" onClick={() => openProject(project.id)}><h3>{project.title}</h3><span>{tasks.filter((t) => t.phase === 'done').length}/{tasks.length} 已完成</span></button>
        <button className="icon-button" aria-label={`项目详情：${project.title}`} onClick={() => openProject(project.id)}><Icon as={MoreHorizontal} size={16}/></button>
      </article>; })}
      {small.map((task) => <article className={`task-card ${singleIds.has(task.projectId) ? 'single-card' : ''} ${needsAttention(task) ? 'needs-attention' : ''} ${dragging?.item.id === task.id ? 'card-dragging' : ''}`} data-card-id={`task:${task.id}`} key={task.id}>
        <div className="task-heading">{handle(task, 'task')}<span className={`status-dot ${task.execution === 'blocked' ? 'blocked' : task.phase === 'done' ? 'done' : task.phase === 'review' ? 'review' : task.execution === 'failed' ? 'failed' : ''}`}/><button className="card-title" onClick={() => openTask(task.id)}><h3>{task.title}</h3></button>{singleIds.has(task.projectId) && <button className="icon-button" aria-label={`管理与拆分：${task.title}`} onClick={() => openProject(task.projectId, 'tasks')} title="项目资料与拆分"><Icon as={MoreHorizontal} size={15}/></button>}</div>
        <div className={`task-status ${task.execution === 'failed' ? 'error-text' : task.execution === 'blocked' ? 'blocked-text' : ''}`}>{EXEC_NAMES[task.execution] || (task.phase === 'idea' ? '灵感' : PHASE_NAMES[task.phase])}</div>
        <p className="latest-progress">{task.error || task.progress || (task.phase === 'ready' ? '确认任务目标与交付要求。' : task.description || '补充任务说明，逐步推进。')}</p>
        <div className="card-actions"><Button kind="outline" onClick={() => openTask(task.id, task.phase === 'review' ? 'acceptance' : 'description')}>{task.phase === 'review' ? '验收详情' : '详情'}</Button><Button kind="text" onClick={() => openChat(task.id)}>主聊天</Button></div>
      </article>)}
      {!big.length && !small.length && <p className="lane-empty">暂无事项</p>}
      </div></section>;
  })}
    {dragging && !dragging.keyboard && <div className="drag-preview" style={{ left: Math.min(dragging.x + 14, window.innerWidth - 206), top: Math.min(dragging.y + 12, window.innerHeight - 66) }}><Icon as={GripVertical} size={15}/>{dragging.item.title}</div>}
  </main>;
}

export function PhaseControls({ item }) {
  return <div className="phase-controls"><span className="phase-label">{PHASE_NAMES[item.phase]}</span><span className="setting-note">回到看板，拖动卡片切换阶段</span></div>;
}
