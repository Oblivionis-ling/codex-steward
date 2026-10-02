import React from 'react';

export const CONFIDENCE_NAMES = { low: '低', medium: '中', high: '高' };
export function HistoryEvidence({ assessment }) {
  if (!assessment) return <p className="setting-note">没有进度判断，请重新整理聊天。</p>;
  return <div className="history-evidence">
    <div className="assessment-heading"><strong>{assessment.summary || '需要检查进度'}</strong><span className={`confidence ${assessment.confidence}`}>可信度：{CONFIDENCE_NAMES[assessment.confidence]}</span></div>
    <p className="assessment-reason">{assessment.reason}</p>
    {assessment.evidence.map((e, i) => <blockquote key={i}><span>{e.role === 'user' ? '用户' : 'Codex'}原文</span><p>{e.quote}</p></blockquote>)}
    {!assessment.evidence.length && <p className="setting-note">缺少可核对的原文，保存前请检查阶段。</p>}
  </div>;
}
