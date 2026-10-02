import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createService } from './tools.mjs';

export function createHttpServer(options = {}) {
  const service = options.service ?? createService(options);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiPath = options.uiPath ?? process.env.STEWARD_UI_PATH ?? (here.endsWith(`${path.sep}dist`) ? path.join(here, 'ui/index.html') : path.resolve('plugins/personal-steward/dist/ui/index.html'));
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '')) return json(403, { error: '只允许本机访问。' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return json(403, { error: '跨域请求已拒绝。' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, name: 'personal-steward', version: '0.2.0', dataDir: service.store.dataDir, pid: process.pid });
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(uiPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }); res.end(html); return;
      }
      if (req.method !== 'POST' || url.pathname !== '/api/tools') return json(404, { error: '页面不存在。' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: '需要 JSON 请求。' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { chunks.push(chunk); size += chunk.length; if (size > 8000000) return json(413, { error: '文件过大，请拆分导入。' }); }
      const { name, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const data = await service.call(name, args);
      json(200, data);
    } catch (error) { json(400, { error: error instanceof z.ZodError || error instanceof SyntaxError ? '输入格式不正确。' : error.message }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createHttpServer();
  const port = Number(process.env.PORT ?? 43187);
  server.on('error', (error) => { process.stderr.write(`启动失败：${error.code}\n`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`个人管家：http://127.0.0.1:${server.address().port}\n`));
}
