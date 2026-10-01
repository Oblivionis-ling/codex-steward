export const demoRecords = [
  { id: 'demo-1', type: 'todo', title: '整理个人作品集的项目说明', content: '补充项目背景、关键决策和成果。', category: '工作', priority: 'high', summary: '补充项目背景、关键决策和成果。' },
  { id: 'demo-2', type: 'material', title: '读完一篇关于知识管理的文章', content: '信息的价值，在于能再次找到它。', category: '学习', priority: 'medium', summary: '信息的价值，在于能再次找到它。', tags: ['知识管理'] },
  { id: 'demo-3', type: 'idea', title: '给摄影作品加一页创作手记', content: '记录拍摄时的选择和现场感受。', category: '灵感', priority: 'medium', summary: '记录拍摄时的选择和现场感受。', tags: ['摄影'] },
  { id: 'demo-4', type: 'todo', title: '试用新的笔记整理方法', content: '从最近一周的记录开始。', category: '学习', priority: 'medium', summary: '从最近一周的记录开始。' },
].map((record) => ({ tags: [], keypoints: [], relatedIds: [], sourceId: null, completed: false, archived: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', archivedAt: null, ...record }));
export const isDemo = new URLSearchParams(location.search).get('demo') === '1';
