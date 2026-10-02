import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Upload } from 'lucide-react';
export function Icon({ as: Component, ...props }) { return <Component size={22} strokeWidth={1.65} aria-hidden="true" {...props}/>; }
export function Button({ children, kind = '', className = '', ...props }) { return <button className={`button ${kind} ${className}`} {...props}>{children}</button>; }
export function Overlay({ title, subtitle, close, children, className = '' }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button, input, textarea, select, a')?.focus();
    const trap = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not([type=file]), textarea, select, a[href]')].filter((element) => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, []);
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={dialog} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><div>{subtitle && <p className="project-context">{subtitle}</p>}<h2>{title}</h2></div><button className="icon-button" aria-label="关闭" onClick={close}><Icon as={X}/></button></header>{children}</section></div>;
}
export function Insight({ item, records, tasks = [], actionsDisabled = false, openRecord, addTodo }) {
  const answer = item.answer.split(/(\[\d+\])/).map((part, index) => {
    const citation = /^\[(\d+)\]$/.exec(part);
    const source = citation && item.sources[Number(citation[1]) - 1];
    return source ? <button className="citation" key={index} onClick={() => openRecord(source.recordId)}>{part}</button> : part;
  });
  return <article className="insight"><h2>{item.type === 'question' ? item.question : `${item.from || '项目开始'} — ${item.to || '现在'}`}</h2><div className="answer">{answer}</div>{item.sources.length > 0 && <section className="sources"><h3>引用来源</h3>{item.sources.map((source, index) => <button key={`${source.recordId}-${index}`} onClick={() => openRecord(source.recordId)}><span>[{index + 1}] {records.find((record) => record.id === source.recordId)?.title || '来源记录'}</span><small>{source.note}</small></button>)}</section>}{item.actions.length > 0 && <section className="suggestions"><h3>后续行动建议</h3>{item.actions.map((action, index) => { const exists = tasks.some((task) => task.title === action.title && task.description === (action.content || action.title)); return <div key={index}><span>{action.title}</span><Button kind="outline" disabled={exists || actionsDisabled} onClick={() => addTodo(action)}>{exists ? '已加入小卡' : '确认加入小卡'}</Button></div>; })}</section>}</article>;
}
export function ModelSettings({ settings, apiKey, setKey, close, save, exportData, importData, storagePath }) {
  const [draft, setDraft] = useState(settings);
  return <Overlay title="设置" close={close}><form onSubmit={async (event) => { event.preventDefault(); if (await save(draft)) close(); }}>
    <label>模型来源<select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}><option value="codex">当前 Codex 聊天</option><option value="api">自选模型（OpenAI 兼容接口）</option></select></label>
    {draft.mode === 'codex' ? <p className="setting-note">资料归档由宿主聊天处理。任务执行、拆分、问答与回顾始终使用已有 Codex 登录。</p> : <><label>API Base URL<input type="url" required value={draft.apiBaseUrl} onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}/></label><label>API Key<input type="password" value={apiKey} autoComplete="off" onChange={(event) => setKey(event.target.value)}/></label><label>模型名称<input required value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}/></label><p className="setting-note">Key 保存在此设备的界面存储，调用时交给本地插件及你选择的模型服务，不写入信息库或备份。此设置只影响资料归档。</p></>}
    <div className="data-settings"><h3>本地数据</h3><p className="storage-path">{storagePath}</p><div className="data-actions"><Button type="button" kind="outline" onClick={exportData}><Icon as={Download} size={18}/>导出备份</Button><label className="button outline upload-label"><Icon as={Upload} size={18}/>导入备份<input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = ''; }}/></label></div></div>
    <div className="dialog-actions"><Button kind="primary" type="submit">保存设置</Button></div>
  </form></Overlay>;
}
