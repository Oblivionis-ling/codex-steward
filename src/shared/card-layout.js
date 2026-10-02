export const isSingleProject = (state, project) => project.layout !== 'group' && state.tasks.filter((t) => t.projectId === project.id).length === 1;

export function inferredProjectPhase(children, single = false) {
  if (!children.length) return 'idea';
  if (single) return children[0].phase;
  if (children.every((t) => t.phase === 'done')) return 'review';
  if (children.some((t) => ['active', 'review', 'done'].includes(t.phase))) return 'active';
  return children.some((t) => t.phase === 'ready') ? 'ready' : 'idea';
}

export function historyProjectPreview(assignments, data) {
  const groups = new Map();
  for (const a of assignments.filter((a) => a.selected !== false)) {
    const key = a.projectId || `new:${a.projectTitle.trim().toLocaleLowerCase()}`;
    if (!groups.has(key)) {
      const project = data.projects.find((p) => p.id === a.projectId);
      groups.set(key, { key, title: project?.title || a.projectTitle, project, children: new Map(data.tasks.filter((t) => t.projectId === a.projectId).map((t) => [t.id, t])) });
    }
    const group = groups.get(key), taskKey = a.taskId || `new:${a.chatId}`, old = group.children.get(taskKey);
    group.children.set(taskKey, { ...old, phase: a.assessment ? a.phase : old?.phase || 'idea' });
  }
  return [...groups.values()].map(({ key, title, project, children }) => {
    const single = project?.layout !== 'group' && children.size === 1;
    return { key, title, count: children.size, single, phase: project?.phase === 'done' && !single ? 'done' : inferredProjectPhase([...children.values()], single) };
  });
}
