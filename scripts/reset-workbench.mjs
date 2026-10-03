import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {backup} from 'node:sqlite';
import {WorkbenchStore} from '../src/server/workbench-store.mjs';

const [dataDir,confirmation]=process.argv.slice(2);
if (!dataDir || !path.isAbsolute(dataDir) || confirmation!=='CLEAR_RECORDS') throw new Error('先停止本插件HTTP服务，再执行：node scripts/reset-workbench.mjs <绝对数据目录> CLEAR_RECORDS');
if (!existsSync(path.join(dataDir,'workbench.sqlite'))) throw new Error('指定目录没有现有数据库，未创建或清理数据。');
const store=new WorkbenchStore(dataDir,'F:\\workspace');
try {
  const dir=path.join(store.dataDir,'backups');await mkdir(dir,{recursive:true});
  const filePath=path.join(dir,`workbench-pre-reset-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  await backup(store.db.database,filePath);
  const removed=store.clearRecords();
  if (store.cards().length || store.cards({archived:true}).length || store.jobs().length) throw new Error('清理后复查不为空。');
  process.stdout.write(JSON.stringify({backup:filePath,removed,remaining:0})+'\n');
} finally {store.close();}
