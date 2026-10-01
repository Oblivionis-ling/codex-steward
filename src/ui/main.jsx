import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar, Capture, RecordList, Detail, Insight, ModelSettings, Overlay, Button, Icon, Search, X, ArrowRight, typeNames, LoaderCircle } from './components';
import * as bridge from './bridge';
import { demoRecords, isDemo } from './demo';
import './styles.css';

const initial = { records: [], insights: [], jobs: [], settings: { mode: 'codex', apiBaseUrl: 'https://api.openai.com/v1', model: '' }, workspace: 'F:\\workspace', storagePath: '' };
const day = (offset = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + offset * 86400000));
function App() {
  const [state, setState] = useState(initial), [view, setView] = useState('library'), [type, setType] = useState('idea');
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [tag, setTag] = useState(''), [filter, setFilter] = useState('all'), [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState(new Set()), [detailId, setDetailId] = useState(''), [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [notice, setNotice] = useState(null), [fallbackChat, setFallbackChat] = useState(null), [backupPath, setBackupPath] = useState('');
  const [theme, setTheme] = useState(bridge.localValue('theme', 'light')), [apiKey, setApiKey] = useState(bridge.localValue('api-key'));
  const [question, setQuestion] = useState(''), [questionFrom, setQuestionFrom] = useState(''), [questionTo, setQuestionTo] = useState(''), [from, setFrom] = useState(day(-6)), [to, setTo] = useState(day());
  const notify = (message, error = false) => setNotice({ message, error });
  const receive = (data) => { setState(data); setLoaded(true); };
  const reload = async () => { if (!isDemo) receive(await bridge.call('steward_state')); };
  useEffect(() => {
    if (isDemo) { receive({ ...initial, records: demoRecords, storagePath: '设计示例 · 不写入用户数据' }); return; }
    let active = true;
    bridge.load().then((data) => { if (active) receive(data); }).catch((error) => { if (active) { notify(error.message, true); setLoaded(true); } });
    const changed = (event) => receive(event.detail);
    window.addEventListener('steward:state', changed);
    const timer = setInterval(() => { if (active && document.visibilityState === 'visible') bridge.call('steward_state').then((data) => { if (active) receive(data); }).catch(() => {}); }, 2500);
    return () => { active = false; clearInterval(timer); window.removeEventListener('steward:state', changed); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; bridge.saveLocalValue('theme', theme); }, [theme]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(null), notice.error ? 10000 : 5500); return () => clearTimeout(timeout); }, [notice]);
  const work = async (fn) => { if (isDemo) { notify('这是只读设计示例，请关闭地址中的 ?demo=1 使用信息库。'); return false; } setBusy(true); try { await fn(); await reload(); return true; } catch (error) { notify(error.message, true); return false; } finally { setBusy(false); } };
  const create = (input) => work(async () => { await bridge.call('steward_create', input); notify('记录已保存。'); });
  const update = (id, patch) => work(async () => { await bridge.call('steward_update', { id, patch }); });
  const openRecord = (id) => setDetailId(id);
  const navigate = (target) => { setView(target); setCategory(''); setTag(''); setFilter('all'); setTypeFilter('all'); setSearch(''); if (target === 'tasks') setType('todo'); };
  const categories = [...new Set(['工作', '学习', '灵感', '生活', ...state.records.map((record) => record.category).filter(Boolean)])];
  const records = useMemo(() => state.records.filter((record) =>
    (view !== 'tasks' || record.type === 'todo') && (typeFilter === 'all' || record.type === typeFilter) && (!category || record.category === category) && (!tag || record.tags.includes(tag)) &&
    (filter === 'all' || (view === 'tasks' ? filter === 'done' ? record.completed : !record.completed : filter === 'archived' ? record.archived : !record.archived)) &&
    (!search.trim() || [record.title, record.content, record.summary, record.category, ...record.tags, ...record.keypoints].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ).sort((a, b) => view === 'tasks' ? Number(a.completed) - Number(b.completed) || ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || Date.parse(b.createdAt) - Date.parse(a.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)), [state.records, view, category, tag, filter, typeFilter, search]);
  const detail = state.records.find((record) => record.id === detailId);
  const activeJobs = state.jobs.filter((job) => ['waiting', 'running'].includes(job.status));
  const latestErrors = state.jobs[0]?.status === 'error' ? [state.jobs[0]] : [];
  const chat = (record) => work(async () => {
    const prepared = await bridge.call('steward_chat', { id: record.id });
    try { await bridge.openLink(prepared.url); notify('已请求打开带有待办内容的新聊天，发送后即可开始。'); } catch { setFallbackChat(prepared); }
  });
  const ai = (input) => work(async () => {
    const prepared = await bridge.call('steward_prepare_ai', input);
    try {
      if (state.settings.mode === 'api') await bridge.call('steward_run_ai', { jobId: prepared.job.id, provider: { ...state.settings, apiKey } });
      else await bridge.sendAI(prepared, state.workspace);
      notify(state.settings.mode === 'api' ? '整理已开始，进度会自动更新。' : bridge.isEmbedded() ? '已交给当前 Codex 聊天，结果会自动更新。' : '已请求打开 Codex；发送请求后，结果会写回这里。');
    } catch (error) { await bridge.call('steward_finish_job', { jobId: prepared.job.id, error: error.message }); throw error; }
    setSelected(new Set());
  });
  const archive = (ids) => ai({ type: 'archive', ...(ids ? { ids } : {}) });
  const exportData = () => work(async () => { const result = await bridge.call('steward_export'); setSettingsOpen(false); setBackupPath(result.filePath); });
  const importData = (file) => work(async () => { if (file.size > 8000000) throw new Error('备份文件大于 8MB，请拆分导入。'); const data = JSON.parse(await file.text()); const result = await bridge.call('steward_import', { data }); notify(`已合并 ${result.imported} 条新记录。`); });
  const titles = { library: ['全部记录', '把零散的念头，留给未来的自己。'], tasks: ['待办', '把下一步，变成已经开始的事。'], question: ['智能问答', '从自己的记录里，找到有出处的答案。'], review: ['阶段回顾', '看看这段时间，什么正在发生。'] };
  const filters = view === 'tasks' ? { all: '全部', pending: '未完成', done: '已完成' } : { all: '全部', pending: '未归档', archived: '已归档' };
  return <div className="app-shell">
    <Sidebar view={view} navigate={navigate} categories={categories} category={category} filterCategory={(name) => { if (!['library', 'tasks'].includes(view)) navigate('library'); setCategory(name); }} theme={theme} toggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} settings={() => setSettingsOpen(true)}/>
    <main><header className="main-header"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div>{['library', 'tasks'].includes(view) && <div className="header-tools"><label className="search"><Icon as={Search} size={21}/><input aria-label="搜索记录" placeholder="搜索记录…" value={search} onChange={(event) => setSearch(event.target.value)}/>{search && <button className="icon-button" aria-label="清除搜索" onClick={() => setSearch('')}><Icon as={X} size={16}/></button>}</label><button className="text-button" disabled={busy || !state.records.some((record) => !record.archived)} onClick={() => archive(selected.size ? [...selected] : undefined)}>{selected.size ? `归档所选（${selected.size}）` : '全部归档'}</button></div>}</header>
    {activeJobs.map((job) => <div className="job-progress" key={job.id}><Icon as={LoaderCircle} size={18} className="spin"/><span>{job.status === 'waiting' ? '等待 Codex 整理' : '正在整理'} · {job.done}/{job.total}</span><progress value={job.done} max={job.total}/><button onClick={() => work(() => bridge.call('steward_cancel_job', { jobId: job.id }))}>取消</button></div>)}
    {latestErrors.map((job) => <div className="error-banner" key={job.id}>上次整理未完成：{job.error}</div>)}
    {['library', 'tasks'].includes(view) ? <>
      <Capture type={type} setType={setType} onSave={create} saving={busy}/>
      <div className="filter-row"><div className="filter-tabs" role="group" aria-label="归档或完成状态">{Object.entries(filters).map(([id, label]) => <button className={filter === id ? 'active' : ''} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="filter-right">{view === 'library' && !isDemo && <select className="type-filter" aria-label="筛选记录类型" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">所有类型</option>{Object.entries(typeNames).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>}<span>{records.length} 条记录</span></div></div>
      {(category || tag) && <div className="active-filters">{category && <button onClick={() => setCategory('')}>{category}<Icon as={X} size={14}/></button>}{tag && <button onClick={() => setTag('')}>#{tag}<Icon as={X} size={14}/></button>}</div>}
      {!loaded ? <div className="empty-state">正在打开本地信息库…</div> : <RecordList records={records} open={(record) => setDetailId(record.id)} chat={chat} archive={archive} update={update} selected={selected} select={(id, checked) => setSelected((previous) => { const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next; })} busy={busy} filterTag={setTag}/>}
    </> : <>
      <form className="insight-form" onSubmit={(event) => { event.preventDefault(); ai(view === 'question' ? { type: 'question', question, from: questionFrom, to: questionTo } : { type: 'review', from, to }); }}>{view === 'question' ? <><label>关于记录，你想知道什么？<textarea required value={question} maxLength={3000} onChange={(event) => setQuestion(event.target.value)} placeholder="比如：最近关于个人作品集，我记过哪些想法？"/></label><div className="date-range"><label>开始日期（可选）<input type="date" value={questionFrom} onChange={(event) => setQuestionFrom(event.target.value)}/></label><span>—</span><label>结束日期（可选）<input type="date" value={questionTo} onChange={(event) => setQuestionTo(event.target.value)}/></label></div></> : <div className="date-range"><label>开始日期<input type="date" required value={from} onChange={(event) => setFrom(event.target.value)}/></label><span>—</span><label>结束日期<input type="date" required value={to} onChange={(event) => setTo(event.target.value)}/></label></div>}<Button kind="primary" disabled={busy}>{view === 'question' ? '提问' : '生成回顾'}<Icon as={ArrowRight}/></Button></form>
      {state.insights.filter((item) => item.type === view).length === 0 && <div className="empty-state"><p>{view === 'question' ? '答案会带着来源一起出现' : '从一段时间的记录开始回顾'}</p><span>{view === 'question' ? '每个引用都可以回到原始记录。' : '关注焦点、进展和行动建议会保存在这里。'}</span></div>}
      {state.insights.filter((item) => item.type === view).map((item) => <Insight key={item.id} item={item} records={state.records} openRecord={openRecord} addTodo={(action) => create({ ...action, type: 'todo', content: action.content || action.title })}/>)}
    </>}
    </main>
    {detail && <Detail key={detail.id} record={detail} close={() => setDetailId('')} save={update} archive={archive} chat={chat} openRecord={openRecord} records={state.records} busy={busy}/>}
    {settingsOpen && <ModelSettings settings={state.settings} apiKey={apiKey} setKey={setApiKey} close={() => setSettingsOpen(false)} storagePath={state.storagePath} save={(settings) => work(async () => { await bridge.call('steward_settings', settings); if (!bridge.saveLocalValue('api-key', apiKey)) notify('此界面不允许持久保存 Key，本次打开期间仍可使用。'); else notify('设置已保存。'); })} exportData={exportData} importData={importData}/>}
    {fallbackChat && <Overlay title="聊天内容已准备好" close={() => setFallbackChat(null)}><p className="setting-note">工作目录：{fallbackChat.workspace}</p><textarea className="prompt-preview" readOnly value={fallbackChat.prompt}/><div className="dialog-actions"><Button kind="outline" onClick={async () => { try { await navigator.clipboard.writeText(fallbackChat.prompt); notify('聊天内容已复制。'); } catch { notify('无法访问剪贴板，请选择文本手动复制。', true); } }}>复制内容</Button><a className="button primary" href={fallbackChat.url}>前往 Codex<Icon as={ArrowRight}/></a></div></Overlay>}
    {backupPath && <Overlay title="备份已保存" close={() => setBackupPath('')}><p className="setting-note">备份文件保存在本机，可从设置中导入恢复。</p><p className="storage-path">{backupPath}</p><div className="dialog-actions"><Button kind="primary" onClick={() => setBackupPath('')}>完成</Button></div></Overlay>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.message}<button className="icon-button" aria-label="关闭通知" onClick={() => setNotice(null)}><Icon as={X} size={16}/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
