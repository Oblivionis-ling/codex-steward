import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, X, Lightbulb, MessageSquare, ArrowUpRight, MoreHorizontal, GripVertical, Archive, RotateCcw, Settings, Moon, Sun, Check, LoaderCircle, ChevronRight, Copy, Layers, RefreshCw } from 'lucide-react';
import { load, call, localValue, saveLocalValue, openLink, closeWorkbench, isEmbedded } from './bridge.js';
import { STAGES, MODES, stageName, WORKFLOW_VERSION } from '../shared/workflow.js';
import './workbench.css';

const date = (value) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
function Modal({ title, close, children, wide = false }) {
  const ref = useRef(null), previouslyFocused = useRef(document.activeElement);
  useEffect(() => {
    ref.current?.focus();
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const list = [...ref.current.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')].filter((x) => x.offsetParent);
        if (!list.length) return;
        if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previouslyFocused.current?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}><section ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon" aria-label="关闭窗口" onClick={close}><X size={18}/></button></header>{children}</section></div>;
}

function App() {
  const [data, setData] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false), [toast,setToast] = useState('');
  const [search,setSearch] = useState(''), [idea,setIdea] = useState(''), [selected,setSelected] = useState(null), [parentId,setParentId] = useState(null), [archived,setArchived] = useState(false), [modal,setModal] = useState(null), [theme,setTheme] = useState(localValue('theme','light'));
  const [drag,setDrag] = useState(null), [dropPhase,setDropPhase] = useState(null), [keyboardPhase,setKeyboardPhase] = useState(null);
  const pointerDrag = useRef(null);
  const notify = (message) => setToast(message);
  const refresh = async () => { const result = await call('steward_state'); setData(result); setError(''); return result; };
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch((e) => setError(e.message)); }, 4000);
    const sync = setInterval(() => { if (document.visibilityState === 'visible') call('steward_sync').then((d) => alive && setData(d)).catch(() => {}); }, 15000);
    const state = (e) => setData(e.detail); window.addEventListener('steward:state',state);
    return () => { alive=false; clearInterval(timer); clearInterval(sync); window.removeEventListener('steward:state',state); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; saveLocalValue('theme',theme); },[theme]);
  useEffect(() => { if (!toast) return; const t=setTimeout(() => setToast(''),7000); return () => clearTimeout(t); },[toast]);
  const perform = async (name,args,success) => {
    setBusy(true);
    try { const r=await call(name,args); await refresh(); if (success) notify(success); return r; }
    catch (e) { notify(e.message); await refresh().catch(() => {}); return null; }
    finally { setBusy(false); }
  };
  const card = [...(data?.cards || []),...(data?.archivedCards || [])].find((c) => c.id === selected);
  const allCards = (archived ? data?.archivedCards : data?.cards) || [];
  const parent = data?.cards.find((c) => c.id === parentId);
  const visible = allCards.filter((c) => (archived || c.parentId === parentId) && (!search || [c.title,c.description,c.draft,c.progress,...c.labels].join('\n').toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const create = async (e) => {
    e.preventDefault(); if (!idea.trim()) return;
    const result=await perform('steward_card_create',{description:idea,...(parentId ? {parentId}: {})},'想法已保存');
    if (result) { setIdea(''); setSelected(result.card.id); }
  };
  const launch = (c,mode) => setModal({type:'launch',id:c.id,mode,version:c.version});
  const move = async (c,phase) => {
    if (!c || phase === c.phase || busy) return;
    if (phase === 'building' && c.phase !== 'review') { launch(c,'build'); return; }
    if (phase === 'done' || STAGES.findIndex((s) => s.id === phase) < STAGES.findIndex((s) => s.id === c.phase) && c.childIds.length) { setModal({type:'move',id:c.id,phase,version:c.version}); return; }
    await perform('steward_card_move',{id:c.id,version:c.version,phase},`已移到${stageName(phase)}`);
  };
  const pointerPhase = (e) => document.elementFromPoint(e.clientX,e.clientY)?.closest('.column')?.dataset.phase;
  const startPointer = (e,c) => {
    if (busy || archived || e.button !== 0) return;
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    pointerDrag.current={id:c.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY,started:false};
    setDrag(null); setDropPhase(null); setKeyboardPhase(null);
  };
  const movePointer = (e) => {
    const p=pointerDrag.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.started && Math.hypot(e.clientX-p.x,e.clientY-p.y)<5) return;
    p.started=true; e.preventDefault(); setDrag(p.id); setDropPhase(pointerPhase(e) || null);
  };
  const finishPointer = (e,cancel=false) => {
    const p=pointerDrag.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const phase=!cancel && p.started ? pointerPhase(e) : null;
    pointerDrag.current=null; setDrag(null); setDropPhase(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (phase) move(data.cards.find((c) => c.id===p.id),phase);
  };
  const handleKeyboard = (e,c) => {
    if (e.key === ' ' && !drag) { e.preventDefault(); setDrag(c.id); setKeyboardPhase(STAGES.findIndex((s) => s.id === c.phase)); notify('左右键选择阶段，Enter 放下，Escape 取消'); }
    else if (drag === c.id && ['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); setKeyboardPhase((i) => Math.max(0,Math.min(4,i+(e.key === 'ArrowLeft' ? -1 : 1)))); }
    else if (drag === c.id && e.key === 'Enter') { e.preventDefault(); move(c,STAGES[keyboardPhase].id); setDrag(null); setKeyboardPhase(null); }
    else if (e.key === 'Escape') { pointerDrag.current=null; setDrag(null); setKeyboardPhase(null); setDropPhase(null); }
  };
  const nativeOpen = async (url) => { try { await openLink(url); } catch (e) { notify(e.message); } };
  return <div className="workbench"><header className="bar"><div className="brand"><Lightbulb size={18}/><span>灵感工作台</span><small>{WORKFLOW_VERSION}</small></div><div className="bar-actions"><label className="search"><Search size={15}/><input aria-label="搜索卡片" placeholder="搜索卡片" value={search} onChange={(e) => setSearch(e.target.value)}/></label><button onClick={() => setModal({type:'history'})}><MessageSquare size={15}/>整理现有聊天</button><button className="icon" aria-label="设置" onClick={() => setModal({type:'settings'})}><Settings size={17}/></button>{isEmbedded() && <button className="icon" aria-label="收起工作台" onClick={() => closeWorkbench().catch((e) => notify(e.message))}><X size={18}/></button>}</div></header>
    <nav className="viewbar"><div className="view-tabs"><button className={!archived ? 'current' : ''} onClick={() => setArchived(false)}><Layers size={14}/>看板</button><button className={archived ? 'current' : ''} onClick={() => {setArchived(true);setParentId(null);setSelected(null);}}><Archive size={14}/>归档{data?.archivedCards.length > 0 && <small>{data.archivedCards.length}</small>}</button></div><span className="quiet">拖动切换阶段 · 在 Codex 里继续工作</span></nav>
    {error && <div className="error" role="alert">{error}<button onClick={() => refresh().catch((e) => setError(e.message))}>重试</button></div>}
    {!data && !error && <div className="loading"><LoaderCircle className="spin" size={20}/>正在打开工作台</div>}
    {data && <>
      {!archived && <form className="capture" onSubmit={create}><Plus size={18}/><input aria-label={parentId ? '记录子任务' : '记录灵感'} placeholder={parentId ? '留下一项子任务…' : '有什么想法？先记下来，不必想完整。'} value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={30000}/><button className="primary" disabled={busy || !idea.trim()}>保存灵感</button></form>}
      {parent && <div className="breadcrumb"><button onClick={() => {setParentId(null);setSelected(parent.id);}}>全部卡片</button><ChevronRight size={14}/><strong>{parent.title}</strong><span>{visible.length} 个子任务</span></div>}
      <main className="columns" aria-label="五阶段看板">{STAGES.map((stage,i) => <section className={`column ${dropPhase === stage.id || drag && keyboardPhase === i ? 'drop-target' : ''}`} key={stage.id} data-phase={stage.id} aria-label={stage.name}><header className="column-title"><span className={`dot dot-${stage.id}`}/><h2>{stage.name}</h2><small>{visible.filter((c) => c.phase === stage.id).length}</small></header><p className="column-hint">{stage.hint}</p><div className="card-stack">{visible.filter((c) => c.phase === stage.id).map((c) => <article className={`card ${selected === c.id ? 'selected' : ''} ${drag === c.id ? 'dragging' : ''}`} key={c.id} data-card-id={c.id}>
        <button className="grip" aria-label={`拖动${c.title}`} aria-pressed={drag === c.id} disabled={busy || archived} onPointerDown={(e) => startPointer(e,c)} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(e) => finishPointer(e,true)} onLostPointerCapture={(e) => finishPointer(e,true)} onKeyDown={(e) => handleKeyboard(e,c)}><GripVertical size={15}/></button>
        <button className="card-body" onClick={() => setSelected(c.id)}><h3>{c.title}</h3></button>
        <button className="icon more" aria-label={`${c.title}的更多操作`} onClick={() => setModal({type:'actions',id:c.id,archived})}><MoreHorizontal size={16}/></button></article>)}</div>{!visible.some((c) => c.phase === stage.id) && <div className="column-empty">{search ? '没有匹配卡片' : stage.id === 'idea' && !archived ? '零散的想法，从这里开始' : '暂时没有卡片'}</div>}</section>)}</main>
      {data.imports.some((j) => ['ready','running','error'].includes(j.status)) && !modal && <button className="pending-import" onClick={() => setModal({type:'history'})}><MessageSquare size={15}/>继续查看聊天整理</button>}
      {card && <Detail key={card.id} card={card} data={data} busy={busy} perform={perform} close={() => setSelected(null)} launch={launch} childBoard={() => {setParentId(card.id);setSelected(null);}} link={() => setModal({type:'history',linkCardId:card.id})} open={nativeOpen} menu={() => setModal({type:'actions',id:card.id,archived:!!card.archivedAt})}/>}
    </>}
    {modal?.type === 'launch' && data && <Launch card={data.cards.find((c) => c.id === modal.id)} mode={modal.mode} version={modal.version} close={() => setModal(null)} perform={perform} busy={busy} notify={notify}/>}
    {modal?.type === 'history' && data && <History data={data} linkCardId={modal.linkCardId} perform={perform} busy={busy} close={() => setModal(null)}/>}
    {modal?.type === 'move' && data && <Modal title={modal.phase === 'done' ? '验收这张卡片' : '回退整个项目'} close={() => setModal(null)}><div className="modal-body"><p>{modal.phase === 'done' ? '确认当前目标已完成？成果和聊天会继续保留。' : '回退会先检查并停止关联聊天，然后把所有子任务退回构思中。原聊天、记录和成果保留。'}</p>{data.cards.find((c) => c.id === modal.id)?.outcome && <pre className="outcome-preview">{data.cards.find((c) => c.id === modal.id).outcome}</pre>}<div className="modal-actions"><button onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={async () => {const r=await perform('steward_card_move',{id:modal.id,version:modal.version,phase:modal.phase,confirm:true},`已移到${stageName(modal.phase)}`);if(r)setModal(null);}}>确认{modal.phase === 'done' ? '验收' : '回退'}</button></div></div></Modal>}
    {modal?.type === 'actions' && data && <Actions card={[...data.cards,...data.archivedCards].find((c) => c.id === modal.id)} archived={modal.archived} perform={perform} busy={busy} close={() => setModal(null)} childBoard={(id) => {setParentId(id);setArchived(false);setModal(null);setSelected(null);}}/>}
    {modal?.type === 'settings' && <Modal title="工作台设置" close={() => setModal(null)}><div className="modal-body settings"><h3>外观</h3><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}切换到{theme === 'dark' ? '浅色' : '深色'}</button><h3>连接与备份</h3><p>在原生 Codex 聊天中构思和实施，沿用你已有的登录。</p><button disabled={busy} onClick={async () => {const r=await perform('steward_codex_status',{});if(r)notify(r.authenticated ? 'Codex 登录可用' : r.error || '请先登录 Codex');}}>检查连接</button><button disabled={busy} onClick={async () => {const r=await perform('steward_export',{});if(r)notify(`备份已保存：${r.filePath}`);}}>备份数据</button><p className="storage-path">{data?.storagePath}</p><p className="quiet">{WORKFLOW_VERSION} · 本地保存 · 默认单卡，按需拆分</p></div></Modal>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon" aria-label="关闭提示" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}

function Detail({card,data,busy,perform,close,launch,childBoard,link,open,menu}) {
  const [tab,setTab] = useState('brief'), [title,setTitle] = useState(card.title), [description,setDescription] = useState(card.description), [draft,setDraft] = useState(card.draft), [note,setNote] = useState(''), [dirty,setDirty] = useState(false);
  const version = useRef(card.version);
  useEffect(() => { if (!dirty) {setTitle(card.title);setDescription(card.description);setDraft(card.draft);version.current=card.version;} },[card.version,dirty]);
  const closeSafe = () => { if (!dirty || window.confirm('有未保存的编辑，确定关闭吗？')) close(); };
  useEffect(() => { const key=(e) => {if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) closeSafe();};document.addEventListener('keydown',key);return () => document.removeEventListener('keydown',key); },[dirty]);
  const set = (fn,value) => { if (!dirty) version.current=card.version; fn(value);setDirty(true); };
  const save = async () => { const r=await perform('steward_card_update',{id:card.id,version:version.current,patch:{title,description,draft}},'需求已保存');if(r){version.current=r.card.version;setDirty(false);} };
  return <aside className="detail" role="dialog" aria-label={`卡片：${card.title}`}><header className="detail-heading"><span>{card.identifier} <span className={`stage-chip ${card.phase}`}>{stageName(card.phase)}</span></span><div><button className="icon" aria-label="更多卡片操作" onClick={menu}><MoreHorizontal size={18}/></button><button className="icon" aria-label="关闭卡片详情" onClick={closeSafe}><X size={18}/></button></div></header><nav className="detail-tabs">{[['brief','需求'],['notes','记录'],['chat','聊天'],['children','子任务']].map(([id,name]) => <button key={id} className={tab===id ? 'current' : ''} onClick={() => setTab(id)}>{name}{id==='notes' && card.comments.length > 0 && <small>{card.comments.length}</small>}</button>)}</nav><div className="detail-content">
    {tab==='brief' && <><input className="title-input" aria-label="卡片标题" readOnly={!!card.archivedAt} value={title} onChange={(e) => set(setTitle,e.target.value)} maxLength={240}/><label className="field">最初的想法<textarea aria-label="最初的想法" readOnly={!!card.archivedAt} value={description} onChange={(e) => set(setDescription,e.target.value)} placeholder="零散、不完整也可以。" rows={4} maxLength={30000}/></label><label className="field">需求草案<span>随着讨论逐步完善</span><textarea aria-label="需求草案" readOnly={!!card.archivedAt} value={draft} onChange={(e) => set(setDraft,e.target.value)} rows={8} maxLength={30000} placeholder="目标、使用方式、范围与已确认的决定…"/></label>{dirty && <div className="save-row"><span>有未保存的编辑</span><button className="primary" disabled={busy || !title.trim()} onClick={save}>保存修改</button></div>}
      {!card.archivedAt && !card.childIds.length && card.phase !== 'done' && <section className="next-step"><h3>{['idea','shaping'].includes(card.phase) ? '继续把想法想清楚' : '继续当前工作'}</h3>{['idea','shaping'].includes(card.phase) && <><div className="thinking-actions">{['discuss','grill','research'].map((m) => <button key={m} disabled={busy || dirty} onClick={() => launch(card,m)}>{MODES[m].name}<ArrowUpRight size={13}/></button>)}</div><p>按需选择，可以重复，也可以跳过。</p></>}<button className="primary build-button" disabled={busy || dirty} onClick={() => launch(card,'build')}>{['building','review'].includes(card.phase) ? '继续实施' : '开始实施'}<ArrowUpRight size={14}/></button>{dirty && <p>先保存编辑，再进入聊天。</p>}</section>}
      {card.progress && <section className="saved-section"><h3>一句进展</h3><p>{card.progress}</p></section>}{card.outcome && <section className="saved-section"><h3>成果与验证</h3><pre>{card.outcome}</pre></section>}{card.importedProgress && <section className="saved-section"><h3>历史进度依据</h3><p>{card.importedProgress.reason}</p>{card.importedProgress.evidence?.map((e,i) => <blockquote key={i}>{e.role==='user' ? '我' : 'Codex'}：{e.quote}</blockquote>)}</section>}
    </>}
    {tab==='notes' && <><h3>想法、决定与回合记录</h3><form className="note-form" onSubmit={async (e) => {e.preventDefault();const r=await perform('steward_card_note',{id:card.id,note},'记录已保存');if(r)setNote('');}}><textarea aria-label="追加记录" readOnly={!!card.archivedAt} placeholder="新想法、做出的决定，或想补充的资料…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={30000} rows={3}/><button disabled={busy || !!card.archivedAt || !note.trim()}>保存记录</button></form>{!card.comments.length && <p className="quiet">这里会留住构思结论和实施成果。</p>}{[...card.comments].reverse().map((c) => <article className="note" key={c.id}><header><strong>{c.authorName}</strong><span>{date(c.createdAt)}</span></header><pre>{c.body}</pre></article>)}</>}
    {tab==='chat' && <><h3>在原生 Codex 聊天继续</h3><p className="quiet">每张卡片保留一个主聊天，盘问、调研和实施沿着这个聊天往下走。</p>{card.threadId ? <div className="chat-link"><MessageSquare size={19}/><div><strong>主聊天</strong><small>{card.lastChatStatus==='running' ? '正在执行' : card.lastChatStatus==='unavailable' ? '暂时无法读取状态' : card.lastChatStatus==='idle' ? '本轮已结束' : '等待刷新状态'}</small></div><button onClick={() => open(`codex://threads/${encodeURIComponent(card.threadId)}`)}><ArrowUpRight size={16}/>打开</button></div> : <div className="empty-chat"><MessageSquare size={25}/><p>从需求页选择聊聊、盘问或调研。首次发送后，Codex 会把聊天关联回来。</p></div>}<div className="inline-actions"><button disabled={!!card.archivedAt || busy} onClick={link}>关联现有聊天</button>{card.threadId && <button disabled={busy} onClick={() => perform('steward_sync',{id:card.id},'聊天状态已刷新')}><RefreshCw size={14}/>刷新状态</button>}</div>{card.relatedChatIds.map((id,i) => <button className="related-link" key={id} onClick={() => open(`codex://threads/${encodeURIComponent(id)}`)}>关联聊天 {i+1}<ArrowUpRight size={13}/></button>)}</>}
    {tab==='children' && <><h3>需要时再拆分</h3><p className="quiet">一个聊天能推进的项目，保留一张卡就够了。需要分开跟进时，再增加子任务。</p><button disabled={!!card.archivedAt} onClick={childBoard}><Layers size={15}/>打开子任务看板</button>{card.childIds.map((id) => {const c=data.cards.find((x) => x.id===id);return c && <div className="child-row" key={id}><span>{c.title}</span><small>{stageName(c.phase)}</small></div>;})}</>}
  </div></aside>;
}

function Launch({card,mode,version,close,perform,busy,notify}) {
  const [prepared,setPrepared] = useState(null);
  if (!card) return null;
  const start = async () => {
    const r=prepared || await perform('steward_card_prepare',{id:card.id,version,mode});if(!r)return;setPrepared(r);
    try {
      if (r.existing) { await navigator.clipboard.writeText(r.prompt); await openLink(r.url); notify('说明已复制，已请求打开主聊天；粘贴并发送即可继续。'); }
      else { await openLink(r.url); notify('已请求打开 Codex 新聊天；发送预填说明后开始，并关联卡片。'); }
      close();
    } catch (e) { notify(`打开聊天未完成：${e.message}。说明保留在这里，可以复制。`); }
  };
  return <Modal title={MODES[mode].name} close={close}><div className="modal-body"><p className="launch-title">{card.title}</p><p>{MODES[mode].detail}</p>{mode==='build' ? <><div className="mode-callout">这一步表示你决定开始实施。Codex 将依据下面的说明推进，成果完成后等你验收。</div><pre className="outcome-preview">{card.draft || card.description || '先回到卡片写一句任务说明。'}</pre></> : <div className="mode-callout">本轮只完善想法和需求草案。可以继续盘问、调研或普通讨论，之后由你决定开始实施。</div>}{card.threadId && <p className="quiet">继续主聊天：复制本轮说明并打开，在原生输入框粘贴发送。</p>}{prepared && <label className="field">本轮聊天说明<textarea aria-label="本轮聊天说明" readOnly value={prepared.prompt} rows={7}/><button onClick={() => navigator.clipboard.writeText(prepared.prompt).then(() => notify('说明已复制')).catch(() => notify('复制不可用，请选中说明手动复制'))}><Copy size={14}/>复制说明</button></label>}<div className="modal-actions"><button onClick={close}>暂时不开始</button><button className="primary" disabled={busy || mode==='build' && !card.draft.trim() && !card.description.trim()} onClick={start}><ArrowUpRight size={15}/>{busy ? '准备中…' : card.threadId ? '复制说明并打开主聊天' : '在 Codex 中打开'}</button></div></div></Modal>;
}

function Actions({card,archived,perform,busy,close,childBoard}) {
  const [idea,setIdea] = useState('');
  if (!card) return null;
  return <Modal title="卡片操作" close={close}><div className="modal-body"><p className="launch-title">{card.title}</p>{!archived && <><h3>添加一个子任务</h3><textarea aria-label="子任务说明" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="确实需要拆开跟进时，再留下一项子任务"/><div className="inline-actions"><button disabled={busy || !idea.trim()} onClick={async () => {const r=await perform('steward_card_create',{description:idea,parentId:card.id},'子任务已创建');if(r)childBoard(card.id);}}><Plus size={14}/>保存子任务</button>{card.childIds.length > 0 && <button onClick={() => childBoard(card.id)}>查看子任务</button>}</div><hr/></>}<p className="quiet">{archived ? '恢复到原阶段，保留原有内容。' : '归档只是从看板收起，随时可以恢复。'}</p><button disabled={busy} onClick={async () => {const r=await perform('steward_card_archive',{id:card.id,version:card.version,restore:!!archived},archived ? '卡片已恢复' : '卡片已归档');if(r)close();}}>{archived ? <RotateCcw size={14}/> : <Archive size={14}/>} {archived ? '恢复卡片' : '归档卡片'}</button></div></Modal>;
}

function History({data,linkCardId,perform,busy,close}) {
  const [listing,setListing] = useState(null), [selected,setSelected] = useState([]), [scope,setScope] = useState('workspace'), [error,setError] = useState(''), [loading,setLoading] = useState(false), [jobId,setJobId] = useState(null), [rows,setRows] = useState(null), [checked,setChecked] = useState([]);
  const request = useRef(0), job = data.imports.find((j) => j.id===jobId);
  const read = async (cursor) => {
    const n=++request.current;setLoading(true);setError('');
    try { const r=await call('steward_chats',{scope,...(cursor ? {cursor}: {})});if(n===request.current)setListing((old) => cursor ? {...r,threads:[...old.threads,...r.threads]} : r); }
    catch (e) {if(n===request.current)setError(e.message);}
    finally {if(n===request.current)setLoading(false);}
  };
  useEffect(() => {setListing(null);setSelected([]);read();return () => {request.current++;};},[scope]);
  useEffect(() => {if(job?.status==='ready' && !rows){setRows(job.result.assignments);setChecked(job.result.assignments.map((r) => r.chatId));}},[job]);
  const patch = (chatId,fields) => setRows((old) => old.map((r) => r.chatId===chatId ? {...r,...fields} : r));
  return <Modal title={linkCardId ? '关联现有聊天' : '整理现有聊天'} close={close} wide><div className="modal-body history-body">
    {!rows && <><div className="history-toolbar"><select aria-label="聊天范围" value={scope} onChange={(e) => setScope(e.target.value)}><option value="workspace">workspace 及子目录</option><option value="all">所有本机聊天</option></select><span className="quiet">{listing ? `${listing.total} 个未归档聊天 · 每批最多 30 个 · 已选 ${selected.length}` : '读取聊天列表'}</span><button disabled={loading} onClick={() => {setSelected([]);read();}}><RefreshCw size={14}/>刷新</button></div>{error && <p className="error" role="alert">{error}</p>}{loading && !listing && <p className="quiet"><LoaderCircle className="spin" size={15}/>读取中…</p>}{listing && <div className="chat-list">{listing.threads.map((c) => <label className="chat-option" key={c.id}><input type={linkCardId ? 'radio' : 'checkbox'} name="chat-choice" checked={selected.includes(c.id)} onChange={(e) => setSelected((old) => linkCardId ? [c.id] : e.target.checked ? [...old,c.id].slice(0,30) : old.filter((id) => id!==c.id))}/><span><strong>{c.title}</strong><small>{c.cwd}</small>{data.cards.some((card) => card.threadId===c.id) && <em>已有关联卡片</em>}</span></label>)}{!listing.threads.length && <p className="quiet">这个范围没有未归档聊天，可以切换到所有本机聊天。</p>}{listing.nextCursor && <button disabled={loading} onClick={() => read(listing.nextCursor)}>加载更多</button>}</div>}{job?.status==='running' && <div className="mode-callout"><LoaderCircle className="spin" size={16}/>正在分析所选聊天，关闭窗口后仍会继续。</div>}{job?.status==='error' && <p className="error" role="alert">{job.error}</p>}{!linkCardId && data.imports.filter((j) => ['ready','running','error'].includes(j.status)).map((j) => <button className="import-resume" key={j.id} onClick={() => {setJobId(j.id);setRows(null);}}>{j.status==='ready' ? '查看整理建议' : j.status==='running' ? '查看生成进度' : '查看失败原因'} · {j.chatIds.length} 个聊天 · {date(j.createdAt)}</button>)}<div className="modal-actions"><button onClick={close}>取消</button>{linkCardId ? <><button disabled={busy || selected.length!==1} onClick={async () => {const c=data.cards.find((c) => c.id===linkCardId);const r=await perform('steward_card_link',{id:c.id,version:c.version,threadId:selected[0],main:false},'已添加关联聊天');if(r)close();}}>添加关联</button><button className="primary" disabled={busy || selected.length!==1} onClick={async () => {const c=data.cards.find((c) => c.id===linkCardId);const r=await perform('steward_card_link',{id:c.id,version:c.version,threadId:selected[0]},'主聊天已关联');if(r)close();}}>作为主聊天</button></> : <button className="primary" disabled={busy || !selected.length || job?.status==='running'} onClick={async () => {const r=await perform('steward_history_analyze',{chatIds:selected});if(r){setJobId(r.job.id);setRows(null);}}}>AI 整理所选聊天</button>}</div></>}
    {rows && <><p className="quiet">核对目标和进度后，选择保存。一聊天一卡；已有卡片保留你的需求正文和草案。</p><div className="proposal-list">{rows.map((r) => <article className="proposal" key={r.chatId}><header><label><input type="checkbox" checked={checked.includes(r.chatId)} onChange={(e) => setChecked((old) => e.target.checked ? [...old,r.chatId] : old.filter((x) => x!==r.chatId))}/><input aria-label="建议卡片标题" value={r.title} onChange={(e) => patch(r.chatId,{title:e.target.value})} maxLength={240}/></label><select aria-label={`${r.title}的建议阶段`} value={r.phase} onChange={(e) => patch(r.chatId,{phase:e.target.value})}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></header><p>{r.assessment.summary}</p><small>置信度：{{low:'低',medium:'中',high:'高'}[r.assessment.confidence]} · {r.assessment.reason}</small>{r.assessment.evidence.map((e,i) => <blockquote key={i}>{e.role==='user' ? '我' : 'Codex'}：{e.quote}</blockquote>)}</article>)}</div><div className="modal-actions"><button onClick={() => {setRows(null);setJobId(null);}}>重新选择</button><button className="primary" disabled={busy || !checked.length} onClick={async () => {const r=await perform('steward_history_apply',{jobId,assignments:rows.filter((r) => checked.includes(r.chatId))},'卡片与进度已保存');if(r)close();}}><Check size={15}/>保存所选 {checked.length} 张卡片</button></div></>}
  </div></Modal>;
}

createRoot(document.getElementById('root')).render(<App/>);
