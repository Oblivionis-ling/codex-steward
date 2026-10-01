import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, FileText, SquareCheck, MessageCircle, ChartNoAxesColumnIncreasing, Folder, Database, Settings, Moon, Sun, ArrowRight, Pencil, Search, X, Check, LoaderCircle, Download, Upload, ArrowUpRight } from 'lucide-react';
export const typeNames = { idea: '想法', material: '资料', todo: '待办' };
export const priorities = { high: '高优先级', medium: '中优先级', low: '低优先级' };
export const icons = { library: FileText, tasks: SquareCheck, question: MessageCircle, review: ChartNoAxesColumnIncreasing };
export function Icon({ as: Component, ...props }) { return <Component size={22} strokeWidth={1.65} aria-hidden="true" {...props}/>; }
export function Button({ children, kind = '', className = '', ...props }) { return <button className={`button ${kind} ${className}`} {...props}>{children}</button>; }
export function Sidebar({ view, navigate, categories, category, filterCategory, theme, toggleTheme, settings }) {
  return <aside className="sidebar">
    <div className="wordmark"><Icon as={BookMarked} size={32}/><span>个人管家</span></div>
    <nav aria-label="个人管家导航">{Object.entries({ library: '全部记录', tasks: '待办', question: '智能问答', review: '阶段回顾' }).map(([id, label]) => <button key={id} className={`nav-link ${view === id ? 'selected' : ''}`} onClick={() => navigate(id)}><Icon as={icons[id]}/>{label}</button>)}</nav>
    <div className="category-section"><span className="section-label">分类</span>{categories.map((name) => <button key={name} className={`category-link ${category === name ? 'selected' : ''}`} onClick={() => filterCategory(category === name ? '' : name)}><Icon as={Folder}/>{name}</button>)}</div>
    <div className="sidebar-bottom"><div className="storage-label"><Icon as={Database}/><span>本地保存</span></div><button className="nav-link" onClick={settings}><Icon as={Settings}/>设置</button><button className="theme-switch icon-button" aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} onClick={toggleTheme}><Icon as={theme === 'dark' ? Sun : Moon}/></button></div>
  </aside>;
}
export function Capture({ type, setType, onSave, saving }) {
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('medium');
  const placeholders = { idea: '记下一闪而过的想法…', material: '粘贴一段资料、链接或阅读笔记…', todo: '写下接下来要做的事…' };
  const submit = async (event) => { event.preventDefault(); if (await onSave({ type, content, priority })) setContent(''); };
  return <form className="capture" onSubmit={submit}>
    <div className="capture-tabs" role="tablist" aria-label="记录类型">{Object.entries(typeNames).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={type === id} className={type === id ? 'active' : ''} onClick={() => setType(id)}><Icon as={id === 'idea' ? Pencil : id === 'material' ? FileText : SquareCheck} size={20}/>{label}</button>)}</div>
    <textarea aria-label="记录内容" placeholder={placeholders[type]} value={content} maxLength={60000} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/>
    <div className="capture-actions">{type === 'todo' && <label className="priority-input">优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}>{Object.entries(priorities).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}<Button kind="primary" type="submit" disabled={saving || !content.trim()}>{saving ? <Icon as={LoaderCircle} className="spin"/> : <>保存记录<Icon as={ArrowRight}/></>}</Button></div>
  </form>;
}
export function RecordList({ records, open, chat, archive, update, select, selected, busy, filterTag }) {
  if (!records.length) return <div className="empty-state"><Icon as={FileText} size={30}/><p>这里还没有记录</p><span>从上面的输入框开始，想法、资料和待办都可以。</span></div>;
  return <div className="record-list">{records.map((record) => <article key={record.id} className={`record-row ${record.completed ? 'completed' : ''}`}>
    <input className="record-check" type="checkbox" aria-label={record.type === 'todo' ? `完成：${record.title}` : `选择：${record.title}`} checked={record.type === 'todo' ? record.completed : selected.has(record.id)} onChange={(event) => record.type === 'todo' ? update(record.id, { completed: event.target.checked }) : select(record.id, event.target.checked)}/>
    <span className={`type-label ${record.type}`}>{typeNames[record.type]}</span>
    <button className="record-copy" onClick={() => open(record)}><h2>{record.title}</h2><p>{record.summary || record.content.split(/\r?\n/).slice(1).join(' ') || record.content}</p></button>
    <div className="record-meta"><span>{record.category || '未分类'}</span>{record.type === 'todo' ? <><span className="meta-dot">·</span><span className={`priority ${record.priority}`}>{priorities[record.priority]}</span></> : record.tags.slice(0, 1).map((tag) => <React.Fragment key={tag}><span className="meta-dot">·</span><button onClick={() => filterTag(tag)}>{tag}</button></React.Fragment>)}</div>
    {record.type === 'todo' ? <Button kind="outline chat-button" disabled={busy} onClick={() => chat(record)}>开始聊天<Icon as={ArrowRight}/></Button> : <button className="text-button archive-button" disabled={busy || record.archived} onClick={() => archive([record.id])}>{record.archived ? <><Icon as={Check} size={16}/>已归档</> : '归档'}</button>}
  </article>)}</div>;
}
export function Overlay({ title, close, children, className = '' }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button, input, textarea, select, a')?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not([type=file]), textarea, select, a[href]')].filter((element) => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, []);
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={dialog} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => { if (event.key === 'Escape') close(); }}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><Icon as={X}/></button></header>{children}</section></div>;
}
export function Detail({ record, close, save, archive, chat, openRecord, records, busy }) {
  const [draft, setDraft] = useState(record);
  return <Overlay title="记录详情" close={close} className="detail-dialog"><form onSubmit={async (event) => { event.preventDefault(); if (await save(record.id, { title: draft.title, content: draft.content, category: draft.category, priority: draft.priority, tags: draft.tags })) close(); }}>
    <label>标题<input required maxLength={240} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
    <div className="field-pair"><label>分类<input maxLength={80} value={draft.category} placeholder="归档后自动生成" onChange={(event) => setDraft({ ...draft, category: event.target.value })}/></label><label>重要度<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{Object.entries(priorities).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <label>原文<textarea required maxLength={60000} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })}/></label>
    <label>标签（用逗号分隔）<input value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 30) })}/></label>
    {record.archived && <div className="archive-detail"><h3>归档总结</h3><p>{record.summary}</p>{record.keypoints.length > 0 && <ul>{record.keypoints.map((point, index) => <li key={index}>{point}</li>)}</ul>}</div>}
    {(record.sourceId || record.relatedIds.length > 0) && <div className="source-links"><h3>来源与关联</h3>{[...(record.sourceId ? [record.sourceId] : []), ...record.relatedIds].map((id) => <button key={id} type="button" onClick={() => openRecord(id)}>{records.find((item) => item.id === id)?.title || '来源记录'}<Icon as={ArrowUpRight} size={16}/></button>)}</div>}
    <span className="detail-date">{typeNames[record.type]} · {new Date(record.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
    <div className="dialog-actions">{record.type === 'todo' && <Button type="button" kind="outline" onClick={() => chat(record)}>开始聊天<Icon as={ArrowRight}/></Button>}<Button type="button" kind="outline" disabled={busy || record.archived} onClick={() => archive([record.id])}>归档</Button><Button type="submit" kind="primary" disabled={busy}>保存修改</Button></div>
  </form></Overlay>;
}
export function Insight({ item, records, openRecord, addTodo }) {
  const answer = item.answer.split(/(\[\d+\])/).map((part, index) => {
    const citation = /^\[(\d+)\]$/.exec(part);
    const source = citation && item.sources[Number(citation[1]) - 1];
    return source ? <button className="citation" key={index} onClick={() => openRecord(source.recordId)}>{part}</button> : part;
  });
  return <article className="insight"><h2>{item.type === 'question' ? item.question : `${item.from} — ${item.to}`}</h2><div className="answer">{answer}</div>{item.sources.length > 0 && <section className="sources"><h3>引用来源</h3>{item.sources.map((source, index) => <button key={`${source.recordId}-${index}`} onClick={() => openRecord(source.recordId)}><span>[{index + 1}] {records.find((record) => record.id === source.recordId)?.title || '来源记录'}</span><small>{source.note}</small></button>)}</section>}{item.actions.length > 0 && <section className="suggestions"><h3>后续行动建议</h3>{item.actions.map((action, index) => { const exists = records.some((record) => record.type === 'todo' && !record.completed && record.title === action.title && record.content === (action.content || action.title)); return <div key={index}><span>{action.title}</span><Button kind="outline" disabled={exists} onClick={() => addTodo(action)}>{exists ? '已有待办' : '加入待办'}</Button></div>; })}</section>}</article>;
}
export function ModelSettings({ settings, apiKey, setKey, close, save, exportData, importData, storagePath }) {
  const [draft, setDraft] = useState(settings);
  return <Overlay title="设置" close={close}><form onSubmit={async (event) => { event.preventDefault(); if (await save(draft)) close(); }}>
    <label>模型来源<select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}><option value="codex">当前 Codex 聊天</option><option value="api">自选模型（OpenAI 兼容接口）</option></select></label>
    {draft.mode === 'codex' ? <p className="setting-note">归档、问答和回顾由当前 Codex 聊天处理，结果写回信息库。</p> : <><label>API Base URL<input type="url" required value={draft.apiBaseUrl} onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}/></label><label>API Key<input type="password" value={apiKey} autoComplete="off" onChange={(event) => setKey(event.target.value)}/></label><label>模型名称<input required value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}/></label><p className="setting-note">Key 保存在此设备的界面存储，调用时交给本地插件及你选择的模型服务，不写入信息库或备份。</p></>}
    <div className="data-settings"><h3>本地数据</h3><p className="storage-path">{storagePath}</p><div className="data-actions"><Button type="button" kind="outline" onClick={exportData}><Icon as={Download} size={18}/>导出备份</Button><label className="button outline upload-label"><Icon as={Upload} size={18}/>导入备份<input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = ''; }}/></label></div></div>
    <div className="dialog-actions"><Button kind="primary" type="submit">保存设置</Button></div>
  </form></Overlay>;
}
export { Search, X, ArrowRight, LoaderCircle, Check };
