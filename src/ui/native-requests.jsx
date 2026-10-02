import React, { useState } from 'react';
import { Overlay, Button } from './components.jsx';

export function NativeRequest({ request, close, perform, busy }) {
  const [answers, setAnswers] = useState({}), [form, setForm] = useState({}), [raw, setRaw] = useState('{}'), [error, setError] = useState('');
  const params = request.params, content = params.request || params;
  const questions = params.questions || [], fields = content.requestedSchema?.properties || {};
  const inputRequest = request.method === 'item/tool/requestUserInput';
  const complex = Object.values(fields).some((field) => !['string', 'number', 'integer', 'boolean'].includes(field.type));
  const submit = async (accept) => { let content = form; if (accept && complex) { try { content = JSON.parse(raw); } catch { setError('请填写有效的 JSON 表单。'); return; } } const result = await perform('steward_reply', { id: request.id, accept, ...(inputRequest ? { answers: Object.fromEntries(questions.map((q) => [q.id, { answers: [answers[q.id] || ''] }])) } : Object.keys(fields).length ? { content } : {}) }, accept ? '回答已发送' : '已拒绝本次请求'); if (result) close(); };
  return <Overlay title={inputRequest ? 'Codex 等待你的回答' : 'Codex 等待你的确认'} close={close}>
    {params.reason && <p>{params.reason}</p>}{content.message && <p>{content.message}</p>}
    {content.mode === 'url' && <><a className="native-link" href={/^https?:\/\//.test(content.url) ? content.url : undefined} target="_blank" rel="noreferrer">打开 {params.serverName || '服务'} 的确认页面</a><p className="setting-note">在服务页面完成后，再确认已完成。</p></>}
    {params.command && <div className="approval-command"><strong>拟执行的操作</strong><pre>{params.command}</pre><p>{params.cwd}</p></div>}
    {params.permissions && <div className="approval-command"><strong>本次请求的权限</strong><pre>{JSON.stringify(params.permissions, null, 2)}</pre></div>}
    {request.item?.changes && <div className="approval-command"><strong>拟修改的文件</strong>{request.item.changes.map((change, i) => <div key={i}><p>{change.path}</p><pre>{change.diff}</pre></div>)}</div>}
    {params.grantRoot && <p>写入范围：{params.grantRoot}</p>}
    {questions.map((q) => <fieldset className="native-question" key={q.id}><legend>{q.question}</legend>{q.options?.map((option) => <label className="checkbox-label" key={option.label}><input type="radio" name={q.id} checked={answers[q.id] === option.label} onChange={() => setAnswers({ ...answers, [q.id]: option.label })}/><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}<label>你的回答<input value={answers[q.id] || ''} maxLength={5000} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}/></label></fieldset>)}
    {complex ? <><pre className="approval-command">{JSON.stringify(content.requestedSchema, null, 2)}</pre><label>表单回答（JSON）<textarea value={raw} onChange={(e) => setRaw(e.target.value)}/></label></> : Object.entries(fields).map(([key, field]) => <label key={key} className={field.type === 'boolean' ? 'checkbox-label' : undefined}>{field.title || key}{field.enum ? <select value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })}><option value="">请选择</option>{field.enum.map((v) => <option key={v} value={v}>{v}</option>)}</select> : field.type === 'boolean' ? <select value={form[key] === undefined ? '' : String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input type={['number', 'integer'].includes(field.type) ? 'number' : field.format === 'password' ? 'password' : 'text'} value={form[key] ?? ''} min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : undefined} onChange={(e) => setForm({ ...form, [key]: e.target.value === '' ? undefined : ['number', 'integer'].includes(field.type) ? Number(e.target.value) : e.target.value })}/>}</label>)}
    {error && <p className="inline-error">{error}</p>}
    <div className="dialog-actions">{!inputRequest && <Button kind="outline" disabled={busy} onClick={() => submit(false)}>拒绝</Button>}<Button kind="primary" disabled={busy || inputRequest && questions.some((q) => !answers[q.id]?.trim()) || !complex && (content.requestedSchema?.required || []).some((key) => form[key] === undefined || form[key] === '')} onClick={() => submit(true)}>{inputRequest ? '发送回答' : content.mode === 'url' ? '我已完成服务确认' : '同意本次操作'}</Button></div>
  </Overlay>;
}
