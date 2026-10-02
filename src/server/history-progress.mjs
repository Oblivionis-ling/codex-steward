import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const chatRunning = (thread) => thread.status?.type === 'active' || thread.turns?.at(-1)?.status === 'inProgress';
export function chatMessages(thread) {
  return (thread.turns || []).flatMap((turn) => (turn.items || []).filter((item) => ['userMessage', 'agentMessage'].includes(item.type)).map((item) => ({ turnId: turn.id, status: turn.status, role: item.type === 'userMessage' ? 'user' : 'assistant', phase: item.phase || '', text: item.text || (item.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n') })));
}
export const chatSourceHash = (thread) => hash({ running: chatRunning(thread), turns: (thread.turns || []).map((t) => [t.id, t.status]), messages: chatMessages(thread) });
export const destinationHash = (state, projectId) => hash([state.projects.find((p) => p.id === projectId), state.tasks.filter((t) => t.projectId === projectId)]);

export function historySource(thread, budget = 18000) {
  const messages = chatMessages(thread), transcript = messages.map((m) => `[turnId=${m.turnId}; role=${m.role}; status=${m.status}; phase=${m.phase}]\n${m.text}`).join('\n\n');
  const marker = '\n\n[中段已省略；以下为最新消息]\n\n', head = Math.floor((budget - marker.length) / 3), tail = budget - marker.length - head;
  const latest = messages.at(-1);
  return { chatId: thread.id, title: thread.name || thread.preview || '', running: chatRunning(thread), latestMessage: latest ? { turnId: latest.turnId, role: latest.role, status: latest.status } : null, transcript: transcript.length <= budget ? transcript : transcript.slice(0, head) + marker + transcript.slice(-tail) };
}

export function validateAssessment(assignment, thread, { inference = false } = {}) {
  let { phase, assessment } = assignment;
  const messages = chatMessages(thread);
  if (!assessment) {
    if (!inference && phase !== 'idea') throw new Error('请选择带有进度依据的建议，再确认阶段。');
    if (!inference) return assignment;
    assessment = { summary: '尚无足够进度证据', reason: '没有提供可核对的聊天原文，请检查阶段。', confidence: 'low', evidence: [] };
  }
  for (const evidence of assessment.evidence) if (!messages.some((m) => m.turnId === evidence.turnId && m.role === evidence.role && m.text.includes(evidence.quote))) throw new Error('进度依据与来源聊天不符，未应用，请重新生成。');
  if (chatRunning(thread)) {
    if (!inference && ['review', 'done'].includes(phase)) throw new Error('来源聊天仍在执行，不能确认待验收或结项。');
    if (inference) { phase = 'active'; assessment = { ...assessment, reason: `来源聊天仍在执行，暂列进行中。${assessment.reason}`.slice(0, 2000) }; }
  }
  if (['review', 'done'].includes(phase) && !assessment.evidence.length) {
    if (!inference) throw new Error('待验收与结项需要可核对的聊天证据。');
    phase = 'ready'; assessment = { ...assessment, confidence: 'low', reason: '缺少交付或验收的聊天证据，暂列待启动，请手动检查。' };
  }
  if (inference && phase === 'done' && !assessment.evidence.some((e) => e.role === 'user')) { phase = 'review'; assessment = { ...assessment, reason: `未提供用户验收原文，暂列待验收。${assessment.reason}`.slice(0, 2000) }; }
  if (!assessment.evidence.length) assessment = { ...assessment, confidence: 'low' };
  return { ...assignment, phase, assessment };
}
