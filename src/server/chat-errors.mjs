export const isWriterConflict = (error) => /already has an active writer/i.test(typeof error === 'string' ? error : error?.message || '');
export const chatBusyMessage = (reason) => reason === 'active'
  ? '主聊天仍在执行或等待回答。请打开原聊天处理，结束后重试。'
  : '主聊天被 Codex 桌面端或其他执行端占用，本轮尚未启动。可打开原聊天、重试，或确认创建接续主聊天。';

export class ChatBusyError extends Error {
  constructor(chatId, reason = 'writer') { super(chatBusyMessage(reason)); this.name = 'ChatBusyError'; this.code = 'CHAT_BUSY'; this.chatId = chatId; this.reason = reason; }
}

export function mapChatError(error, chatId) {
  return error instanceof ChatBusyError ? error : isWriterConflict(error) ? new ChatBusyError(chatId) : error;
}
