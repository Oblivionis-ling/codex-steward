import React from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, ArrowLeft, ArrowRight, Plus, MessageSquare, Check } from 'lucide-react';
import { Icon, Button } from './components.jsx';

export const PHASES = ['idea', 'ready', 'active', 'review', 'done'];
export const PHASE_NAMES = { idea: '灵感池', ready: '待启动', active: '进行中', review: '待验收', done: '已结项' };
export const EXEC_NAMES = { idle: '', starting: '正在启动', running: '运行中', waiting: '等你处理', failed: '执行失败', stopping: '正在停止' };
export const needsAttention = (task) => task.phase === 'review' || ['waiting', 'failed'].includes(task.execution);
export function Board({ data, expanded, expand, openProject, openTask, moveTask, busy, search }) {
  const query = search.trim().toLowerCase();
  const projects = data.projects.filter((p) => !query || `${p.title} ${p.goal}`.toLowerCase().includes(query) || data.tasks.some((t) => t.projectId === p.id && `${t.title} ${t.description}`.toLowerCase().includes(query)));
  const children = data.tasks.filter((t) => t.projectId === expanded && (!query || `${t.title} ${t.description}`.toLowerCase().includes(query)));
  return <main className="board" aria-label="五栏任务看板">{PHASES.map((phase) => {
    const big = projects.filter((p) => p.phase === phase), small = children.filter((t) => t.phase === phase);
    return <section className="lane" key={phase} aria-label={PHASE_NAMES[phase]}><header className="lane-header"><h2>{PHASE_NAMES[phase]}</h2><span aria-label="卡片数量">{big.length + small.length}</span></header>
      <div className="lane-cards">{big.map((project) => { const tasks = data.tasks.filter((t) => t.projectId === project.id); return <article className={`project-card ${expanded === project.id ? 'expanded' : ''}`} key={project.id}>
        <button className="disclosure icon-button" aria-label={`${expanded === project.id ? '收起' : '展开'}：${project.title}`} aria-expanded={expanded === project.id} onClick={() => expand(expanded === project.id ? null : project.id)}><Icon as={expanded === project.id ? ChevronDown : ChevronRight} size={18}/></button>
        <button className="project-copy" onClick={() => openProject(project.id)}><h3>{project.title}</h3><span>{tasks.filter((t) => t.phase === 'done').length}/{tasks.length} 已完成</span></button>
        <button className="icon-button" aria-label={`项目详情：${project.title}`} onClick={() => openProject(project.id)}><Icon as={MoreHorizontal} size={18}/></button>
      </article>; })}
      {small.map((task) => <article className={`task-card ${needsAttention(task) ? 'needs-attention' : ''}`} key={task.id}>
        <div className="task-heading"><span className={`status-dot ${task.phase === 'done' ? 'done' : task.phase === 'review' ? 'review' : task.execution === 'failed' ? 'failed' : ''}`}/><button className="card-title" onClick={() => openTask(task.id)}><h3>{task.title}</h3></button></div>
        <div className={`task-status ${task.execution === 'failed' ? 'error-text' : ''}`}>{EXEC_NAMES[task.execution] || (task.phase === 'idea' ? '灵感' : PHASE_NAMES[task.phase])}</div>
        <p className="latest-progress">{task.error || task.progress || (task.phase === 'ready' ? '确认任务目标与交付要求。' : task.description || '补充任务说明，逐步推进。')}</p>
        <div className="card-actions"><Button kind="outline" onClick={() => openTask(task.id)}>{task.phase === 'review' ? '验收' : '查看'}</Button>
          {task.mainChatId ? <Button kind="outline" onClick={() => openTask(task.id, 'chat')}>主聊天</Button> : task.phase === 'idea' ? <Button kind="outline" disabled={busy} onClick={() => moveTask(task, 'ready')}>下一步</Button> : <Button kind="outline" onClick={() => openTask(task.id, 'acceptance')}>下一步</Button>}
        </div>
      </article>)}
      {!big.length && !small.length && <p className="lane-empty">暂无事项</p>}
      </div></section>;
  })}</main>;
}

export function PhaseControls({ item, kind, move, busy, openRollback }) {
  const index = PHASES.indexOf(item.phase);
  return <div className="phase-controls"><span className="phase-label">{PHASE_NAMES[item.phase]}</span><div>
    {index > 0 && <Button kind="outline" disabled={busy || item.execution === 'starting' || item.execution === 'stopping'} onClick={() => kind === 'project' ? openRollback(item) : move(item, PHASES[index - 1])}><Icon as={ArrowLeft} size={16}/>退回</Button>}
    {kind === 'project' && index < 4 && <Button kind="outline" disabled={busy} onClick={() => move(item, PHASES[index + 1])}>推进到{PHASE_NAMES[PHASES[index + 1]]}<Icon as={ArrowRight} size={16}/></Button>}
  </div></div>;
}
