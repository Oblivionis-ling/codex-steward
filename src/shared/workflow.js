export const WORKFLOW_VERSION = '0.3.2';
export const STAGES = [
  { id: 'idea', name: '灵感池', hint: '先留下一点想法', status: 'backlog' },
  { id: 'shaping', name: '构思中', hint: '讨论 · 盘问 · 调研', status: 'todo' },
  { id: 'building', name: '进行中', hint: '已经决定开始做', status: 'in_progress' },
  { id: 'review', name: '待验收', hint: '看看成果是否合意', status: 'in_review' },
  { id: 'done', name: '已结项', hint: '留下成果和经验', status: 'done' },
];
export const stageForStatus = (status) => STAGES.find((s) => s.status === status)?.id || 'building';
export const statusForStage = (phase) => STAGES.find((s) => s.id === phase)?.status;
export const stageName = (phase) => STAGES.find((s) => s.id === phase)?.name || phase;
export const MODES = {
  discuss: { name: '聊聊想法', detail: '从零散想法开始，一起把目标聊清楚' },
  grill: { name: '盘问需求', detail: '调用 grill-me，逐个确认关键问题' },
  research: { name: '调研方案', detail: '调用 idea-research，找已有方案和实现依据' },
  build: { name: '开始实施', detail: '依据当前需求草案推进并交付' },
};
