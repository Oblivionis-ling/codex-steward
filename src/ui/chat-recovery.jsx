import React from 'react';
import { Overlay, Button } from './components.jsx';

export function ChatRecovery({ task, close, perform, busy, done }) {
  return <Overlay title="创建接续主聊天" close={close}>
    <p>为「{task.title}」复制原聊天历史，建立新的主聊天，随后发送已保存的说明、验收标准和本次修改意见。</p>
    <p className="setting-note">原聊天保留为关联；这张小卡的后续阶段继续使用新的主聊天。原聊天仍在执行时，请先在原聊天处理。</p>
    <div className="dialog-actions"><Button kind="outline" disabled={busy} onClick={close}>取消</Button><Button kind="primary" disabled={busy} onClick={async () => { const result = await perform('steward_task_continue', { id: task.id, expectedMainChatId: task.mainChatId, expectedHash: task.confirmedHash }, '已在接续主聊天开始执行'); if (result) done(task.id); }}>确认创建并执行</Button></div>
  </Overlay>;
}
