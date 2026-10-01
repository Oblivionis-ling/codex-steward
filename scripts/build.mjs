import { build as viteBuild } from 'vite';
import { build as esBuild } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await viteBuild();
await mkdir('plugins/personal-steward/dist', { recursive: true });
for (const entry of ['mcp', 'http']) {
  await esBuild({ entryPoints: [`src/server/${entry}.mjs`], outfile: `plugins/personal-steward/dist/${entry}.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, minify: true, banner: { js: "import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);" } });
}
process.stdout.write('已构建独立 MCP 服务与单文件界面。\n');
