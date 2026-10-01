import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { createService, toolSchemas, toolDescriptions, toolOutputSchemas } from './tools.mjs';

const service = createService();
const icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="#36584b" stroke-width="1.8"><rect x="6" y="3" width="22" height="26" rx="2"/><path d="M10 3v26M3 8h6M3 16h6M3 24h6"/></svg>').toString('base64');
const server = new McpServer({ name: 'personal-steward', title: '个人管家', version: '0.1.0', icons: [{ src: icon, mimeType: 'image/svg+xml', sizes: ['any'] }] });
new OpenAIExtensions(server);
const UI_URI = 'ui://personal-steward/library.html';
const here = path.dirname(fileURLToPath(import.meta.url));
const uiPath = process.env.STEWARD_UI_PATH ?? (here.endsWith(`${path.sep}dist`) ? path.join(here, 'ui/index.html') : path.resolve('plugins/personal-steward/dist/ui/index.html'));

registerAppResource(server, 'steward-library', UI_URI, { title: '个人管家', description: '本地记录与待办界面' }, async () => ({
  contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(uiPath, 'utf8'), _meta: {
    ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
    'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen', 'inline'] },
    'openai/widgetDescription': '个人管家本地信息库。支持三态记录、AI 整理、待办勾选和从待办开始 Codex 聊天。',
  } }],
}));

const readOnly = new Set(['steward_open', 'steward_panel', 'steward_state', 'steward_records', 'steward_chat']);
const appOnly = new Set(['steward_run_ai', 'steward_settings', 'steward_import']);
for (const [name, inputSchema] of Object.entries(toolSchemas)) {
  const entrypoint = name === 'steward_open' || name === 'steward_panel';
  const metadata = entrypoint ? {
    ui: { resourceUri: UI_URI, visibility: ['model', 'app'] },
    'openai/outputTemplate': UI_URI,
    'openai/ui': { entrypoints: [{ type: name === 'steward_open' ? 'global' : 'thread' }] },
    'openai/widgetAccessible': true,
  } : { ui: { visibility: appOnly.has(name) ? ['app'] : ['model', 'app'] }, 'openai/widgetAccessible': true };
  const config = {
    title: name === 'steward_open' ? '个人管家' : name === 'steward_panel' ? '记录与待办' : toolDescriptions[name].split('。')[0],
    description: toolDescriptions[name], inputSchema,
    outputSchema: toolOutputSchemas[name],
    annotations: { readOnlyHint: readOnly.has(name), destructiveHint: false, openWorldHint: name === 'steward_run_ai' },
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
