'use client';

import { fromShanghaiInput, shanghaiDateTime, shanghaiInput } from '@/lib/event-date';
import type { EventDraft } from '@/lib/types';

export default function EventEditor({ value, onChange, confirmed, onConfirm }: {
  value: EventDraft; onChange: (value: EventDraft) => void; confirmed: boolean; onConfirm: (value: boolean) => void;
}) {
  const change = (patch: Partial<EventDraft>) => onChange({ ...value, ...patch });
  const sourceVerified = value.deadline_source_text && value.source_text.includes(value.deadline_source_text);
  return <div className="panel space-y-5">
    <div className="notice notice-warning font-semibold">整理草稿 · 请对照原通知核对以下内容</div>
    {value.source_url && <a className="break-all text-sm" href={value.source_url} target="_blank" rel="noreferrer">查看原通知：{value.source_url}</a>}
    <label className="field-label">事项标题<input value={value.title} maxLength={300} onChange={e => change({ title: e.target.value })} className="field" /></label>
    {value.title === '请补充事项标题' && <p className="notice notice-warning">原文片段没有完整标题，请对照原通知补充后保存。</p>}
    <label className="field-label">摘要<textarea value={value.summary} onChange={e => change({ summary: e.target.value })} rows={3} className="field" /></label>
    <label className="field-label">谁能申请<textarea value={value.eligibility} onChange={e => change({ eligibility: e.target.value })} rows={2} className="field" /></label>
    <label className="field-label">提交方式或地点<textarea value={value.submit_to} onChange={e => change({ submit_to: e.target.value })} rows={2} className="field" /></label>
    <label className="field-label">原通知链接（可编辑）<input type="url" value={value.source_url || ''} onChange={e => change({ source_url: e.target.value || null })} className="field" /></label>
    <label className="field-label">发布日期<input type="date" value={value.publish_date || ''} onChange={e => change({ publish_date: e.target.value || null })} className="field max-w-xs" /></label>
    <div className="space-y-3 rounded-lg p-4" style={{ background: 'var(--soft)', border: '1px solid var(--border)' }}>
      <label className="field-label">截止时间（上海时间）
        <input type="datetime-local" value={value.deadline ? shanghaiInput(value.deadline) : ''} onChange={e => { change({ deadline: e.target.value ? fromShanghaiInput(e.target.value) : null, deadline_inferred: false }); onConfirm(false); }} className="field" />
      </label>
      {value.deadline && <p className="text-sm">当前：{shanghaiDateTime(value.deadline)}{value.deadline_inferred && <strong className="ml-2" style={{ color: 'var(--error)' }}>相对日期推算，待确认</strong>}</p>}
      <p className="notice notice-warning">{!value.deadline ? '原文未确认截止时间，请核对后按“无截止时间”保存。' : value.deadline_inferred ? '该时间由相对日期推算，仍需对照原文确认。' : confirmed ? '已由你对照原文确认截止时间。' : '截止时间尚未确认，请对照原文核对。'}</p>
      <label className="field-label">日期所在原文句子<input value={value.deadline_source_text || ''} onChange={e => { change({ deadline_source_text: e.target.value || null }); onConfirm(false); }} className="field" /></label>
      {value.deadline_source_text && <p className="notice notice-warning">{value.deadline_source_text}{!sourceVerified && <b className="ml-2">未在原文找到依据</b>}</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed && !!value.deadline} disabled={!value.deadline || !sourceVerified} onChange={e => onConfirm(e.target.checked)} />我已对照原通知确认截止时间</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed && !value.deadline} onChange={e => { if (e.target.checked) change({ deadline: null, deadline_inferred: false }); onConfirm(e.target.checked); }} />无法确认截止时间，按无截止时间保存</label>
    </div>
    <div className="space-y-3"><h3 className="font-semibold">材料清单</h3>
      {value.materials.map((item, index) => <div key={index} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
        <div className="flex gap-2"><input aria-label={`材料${index + 1}名称`} value={item.name} onChange={e => change({ materials: value.materials.map((entry, i) => i === index ? { ...entry, name: e.target.value } : entry) })} className="field min-w-0 flex-1" />
          <button type="button" onClick={() => change({ materials: value.materials.filter((_, i) => i !== index) })} className="button-quiet" style={{ color: 'var(--error)' }}>删除</button></div>
        <input aria-label={`材料${index + 1}依据`} value={item.source_text} onChange={e => change({ materials: value.materials.map((entry, i) => i === index ? { ...entry, source_text: e.target.value } : entry) })} placeholder="原文依据句子" className="field mt-2" />
        {(!item.source_text || !value.source_text.includes(item.source_text)) && <p className="mt-1 text-sm" style={{ color: 'var(--error)' }}>未在原文找到依据，请人工核对</p>}
      </div>)}
      <button type="button" onClick={() => change({ materials: [...value.materials, { name: '', done: false, source_text: '' }] })} className="button-secondary">添加材料</button>
    </div>
    <details className="text-sm"><summary className="min-h-11 cursor-pointer">查看通知原文</summary><p className="notice mt-2 whitespace-pre-wrap">{value.source_text}</p></details>
  </div>;
}
