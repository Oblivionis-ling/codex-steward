export const PHASES = ['idea', 'ready', 'active', 'review', 'done'];
export const PHASE_NAMES = { idea: '灵感池', ready: '待启动', active: '进行中', review: '待验收', done: '已结项' };

export function dropIntent(item, kind, phase, data) {
  const delta = PHASES.indexOf(phase) - PHASES.indexOf(item.phase);
  if (!delta) return { allowed: false, reason: '卡片已经在这一栏。' };
  if (Math.abs(delta) !== 1) return { allowed: false, reason: '请拖到相邻阶段，逐步推进或回退。' };
  const project = kind === 'project' ? item : data.projects.find((p) => p.id === item.projectId);
  if (project?.transitionId || ['starting', 'stopping'].includes(item.execution)) return { allowed: false, reason: '正在启动或停止，请稍后再拖动。' };
  if (delta < 0) return { allowed: true, action: kind === 'project' ? 'rollbackProject' : ['active', 'review', 'done'].includes(item.phase) ? 'rollbackTask' : 'move', reason: kind === 'project' ? '停止所属执行，全部小卡回到待启动' : '回退并保留聊天与已有成果' };
  if (kind === 'project') {
    if (['review', 'done'].includes(phase) && data.tasks.some((t) => t.projectId === item.id && t.phase !== 'done')) return { allowed: false, reason: '先完成所有小卡的验收，再推进项目。' };
    return { allowed: true, action: phase === 'done' ? 'acceptProject' : 'move', reason: phase === 'done' ? '确认项目结项' : `推进到${PHASE_NAMES[phase]}` };
  }
  if (phase === 'active') {
    if (!item.confirmedHash || !item.description.trim() || !item.criteria.length) return { allowed: true, action: 'criteria', reason: '先检查并确认验收标准' };
    return { allowed: true, action: 'start', reason: '发送已保存的说明，开始主聊天执行' };
  }
  if (phase === 'review') return { allowed: false, reason: '提交完整交付证据并结束执行后，自动进入待验收。' };
  if (phase === 'done') {
    if (!(item.historyProgress?.eligible && item.historyProgress.assessment.evidence.length) && (!item.delivery || !item.deliveryHash || item.deliveryHash !== item.confirmedHash)) return { allowed: false, reason: '本轮尚无完整交付证据，请打开验收详情。' };
    return { allowed: true, action: 'acceptTask', reason: '检查交付证据，确认后结项' };
  }
  return { allowed: true, action: 'move', reason: `推进到${PHASE_NAMES[phase]}` };
}
