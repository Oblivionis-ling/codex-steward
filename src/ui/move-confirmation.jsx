import React from 'react';
import { Button, Overlay } from './components.jsx';
import { PHASE_NAMES } from './transitions.js';
import { HistoryEvidence } from './history-evidence.jsx';

export function MoveConfirmation({ item, kind, phase, action, close, perform, busy, done }) {
  const rollback = action === 'rollbackTask', title = rollback ? '回退这张卡片' : kind === 'project' ? '确认项目结项' : '确认验收并结项';
  return <Overlay title={title} close={close}>
    <p>「{item.title}」：{PHASE_NAMES[item.phase]} → {PHASE_NAMES[phase]}</p>
    {rollback ? <p className="setting-note">先停止这张卡片的当前执行，取得停止确认后再回退。聊天和已有成果保留，本轮交付确认会清除。</p> : kind === 'project' ? <p className="setting-note">所有子任务已验收结项，请确认长期项目的目标已经完成。</p> : item.historyProgress?.eligible && !item.deliveryHash ? <><p className="setting-note">这是从历史聊天整理的成果。请核对原文并确认当前任务目标已经完成。</p><HistoryEvidence assessment={item.historyProgress.assessment}/><a href={`codex://threads/${encodeURIComponent(item.historyProgress.chatId)}`}>查看来源聊天</a></> : <div className="delivery"><p>{item.delivery?.summary || '尚无可验收成果'}</p>{item.delivery?.checks.map((check, index) => <div className="evidence" key={index}><strong>{check.criterion}</strong><p>{check.evidence}</p></div>)}</div>}
    <div className="dialog-actions"><Button kind="outline" disabled={busy} onClick={close}>取消</Button><Button kind="primary" disabled={busy} onClick={async () => { const result = await perform(kind === 'project' ? 'steward_project_move' : 'steward_task_move', { id: item.id, phase, expectedPhase: item.phase }, rollback ? '小卡已回退' : '已确认结项'); if (result) done(); }}>{rollback ? '停止并回退' : '确认结项'}</Button></div>
  </Overlay>;
}
