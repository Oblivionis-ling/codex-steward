import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { createService, toolSchemas, toolDescriptions, toolOutputSchemas } from './workbench.mjs';
import { brokerClient } from './broker.mjs';

const service = process.env.STEWARD_BROKER === '1' ? brokerClient() : createService();
const icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="#292d32" stroke-width="1.8"><rect x="4" y="5" width="24" height="22" rx="2"/><path d="M12 5v22M20 5v22M4 12h24"/></svg>').toString('base64');
const server = new McpServer({ name: 'personal-steward', title: '灵感工作台', version: '0.3.0', icons: [{ src: icon, mimeType: 'image/svg+xml', sizes: ['any'] }] });
new OpenAIExtensions(server);
const UI_URI = 'ui://personal-steward/library.html';
const here = path.dirname(fileURLToPath(import.meta.url));
const uiPath = process.env.STEWARD_UI_PATH ?? (here.endsWith(`${path.sep}dist`) ? path.join(here, 'ui/index.html') : path.resolve('plugins/personal-steward/dist/ui/index.html'));

registerAppResource(server, 'steward-library', UI_URI, { title: '灵感工作台', description: '从零散灵感到交付的五阶段看板' }, async () => ({
  contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(uiPath, 'utf8'), _meta: {
    ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
    'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen', 'inline'] },
    'openai/widgetDescription': '灵感工作台。随手记录灵感，在原生 Codex 聊天中讨论、盘问或调研，保存需求草案；用户决定开始实施，交付后确认验收。默认单卡，按需拆分。',
  } }],
}));

const readOnly = new Set(['steward_open', 'steward_panel', 'steward_state', 'steward_card_read', 'steward_codex_status', 'steward_chats', 'steward_chat_history']);
const appOnly = new Set(['steward_card_prepare', 'steward_card_move', 'steward_card_archive', 'steward_card_link', 'steward_card_update', 'steward_history_apply', 'steward_history_analyze', 'steward_export']);
for (const [name, inputSchema] of Object.entries(toolSchemas)) {
  const entrypoint = name === 'steward_open' || name === 'steward_panel';
  const metadata = entrypoint ? {
    ui: { resourceUri: UI_URI, visibility: ['model', 'app'] },
    'openai/outputTemplate': UI_URI,
    'openai/ui': { entrypoints: [{ type: name === 'steward_open' ? 'global' : 'thread' }] },
    'openai/widgetAccessible': true,
  } : { ui: { visibility: appOnly.has(name) ? ['app'] : ['model', 'app'] }, 'openai/widgetAccessible': true };
  const config = {
    title: name === 'steward_open' ? '灵感工作台' : name === 'steward_panel' ? '灵感工作台' : toolDescriptions[name].split('。')[0],
    description: toolDescriptions[name], inputSchema,
    outputSchema: toolOutputSchemas[name],
    annotations: { readOnlyHint: readOnly.has(name), destructiveHint: ['steward_project_move', 'steward_task_move'].includes(name), openWorldHint: ['steward_run_ai', 'steward_task_start', 'steward_propose', 'steward_chat_send'].includes(name) },
    _meta: metadata,
    ...(entrypoint ? { icons: [{ src: icon, mimeType: 'image/svg+xml', sizes: ['any'] }] } : {}),
  };
  const handler = async (args) => {
    try {
      const data = await service.call(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      const message = error instanceof z.ZodError ? '参数格式不正确，请检查字段和长度。' : error.message;
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  };
  if (entrypoint) registerAppTool(server, name, config, handler);
  else server.registerTool(name, config, handler);
}
await server.connect(new StdioServerTransport());
