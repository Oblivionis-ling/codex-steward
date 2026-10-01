import { App } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';

let app, extensions, initialState, connecting;
const embedded = window.parent !== window;
export const localValue = (key, fallback = '') => { try { return localStorage.getItem(`steward:${key}`) ?? fallback; } catch { return fallback; } };
export const saveLocalValue = (key, value) => { try { localStorage.setItem(`steward:${key}`, value); return true; } catch { return false; } };
export async function connect() {
  if (!embedded) return;
  if (connecting) return connecting;
  app = new App({ name: 'personal-steward', version: '0.1.0' });
  extensions = new OpenAIExtensions(app);
  app.ontoolresult = (result) => {
    if (result.structuredContent?.records) { initialState = result.structuredContent; window.dispatchEvent(new CustomEvent('steward:state', { detail: initialState })); }
  };
  app.onhostcontextchanged = (context) => {
    if (!localValue('theme') && context.theme) { document.documentElement.dataset.theme = context.theme; }
  };
  connecting = app.connect();
  return connecting;
}
export async function call(name, args = {}) {
  if (embedded) {
    await connect();
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content?.find((item) => item.type === 'text')?.text || '插件调用失败。');
    return result.structuredContent ?? JSON.parse(result.content?.find((item) => item.type === 'text')?.text || '{}');
  }
  const response = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地服务调用失败。');
  return result;
}
export async function load() { await connect(); return initialState ?? call('steward_state'); }
export async function openLink(url) {
  if (embedded) {
    await connect();
    const result = await app.openLink({ url });
    if (result.isError) throw new Error('宿主未能打开这个链接，请复制聊天内容到 Codex。');
  } else { window.location.assign(url); }
}
export async function sendAI(prepared, workspace) {
  if (embedded) {
    await connect();
    const content = [{ type: 'text', text: prepared.prompt }];
    const result = extensions.message ? await extensions.message.send({ role: 'user', content }) : await app.sendMessage({ role: 'user', content });
    if (result.isError) throw new Error('宿主未能发送整理请求。');
  } else {
    await openLink(`codex://new?${new URLSearchParams({ path: workspace, prompt: prepared.prompt })}`);
  }
}
export const isEmbedded = () => embedded;
