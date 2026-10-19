'use client';

import { useState } from 'react';
import { analyzeNoticeDeadline, reparseDraftDates, shanghaiDateTime } from '@/lib/event-date';
import { deadlineEvidenceCandidates } from '@/lib/notice-dates';
import { displayDate } from '@/lib/date-only';
import type { EventDraft, EventDateContext } from '@/lib/types';
import DateInput from './DateInput';
import DateTimeInput from './DateTimeInput';
import EventContacts from './EventContacts';

export default function EventEditor({ value, onChange, confirmed, onConfirm, onDateValidityChange }: {
  value: EventDraft; onChange: (value: EventDraft) => void; confirmed: boolean; onConfirm: (value: boolean) => void; onDateValidityChange?: (valid: boolean) => void;
}) {
  const change = (patch: Partial<EventDraft>) => onChange({ ...value, ...patch });
  const [publishValid, setPublishValid] = useState(true);
  const [deadlineValid, setDeadlineValid] = useState(true);
  const analyzed = analyzeNoticeDeadline(value.source_text, value.deadline_source_text, !value.date_context || value.date_context.basis === 'user' ? value.publish_date : null,
    value.date_context?.candidates || [], value.date_context?.publication_cleared);
  const context: EventDateContext = value.date_context || analyzed.context;
  const reparse = (patch: Partial<EventDraft>, adopt = false) => {
    const next = reparseDraftDates(value, patch, adopt);
    if (patch.publish_date !== undefined) setPublishValid(true);
    if (adopt || next.deadline !== value.deadline) setDeadlineValid(true);
    onDateValidityChange?.((patch.publish_date !== undefined || publishValid) && (adopt || next.deadline !== value.deadline || deadlineValid));
    onChange(next); onConfirm(false);
  };
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
    <DateInput value={value.publish_date} onChange={publish_date => reparse({ publish_date })} onValidityChange={valid => { setPublishValid(valid); onDateValidityChange?.(valid && deadlineValid); onConfirm(false); }} />
    {context.candidates.length > 0 && <div className="space-y-2"><h3>发布日期候选与依据</h3>{context.candidates.map((candidate, index) => <div key={index} className="notice text-sm"><b>{candidate.kind === 'signature' ? '正文落款' : '网页日期'}：{displayDate(candidate.date)}</b><p className="whitespace-pre-wrap">{candidate.evidence}</p><button type="button" className="underline" onClick={() => reparse({ publish_date: candidate.date })}>选择此日期依据</button></div>)}</div>}
    <div className="space-y-3 rounded-lg p-4" style={{ background: 'var(--soft)', border: '1px solid var(--border)' }}>
      <DateTimeInput value={value.deadline} onChange={deadline => { change({ deadline, deadline_inferred: false, date_context: { ...context, mode: 'manual', state: deadline ? 'manual' : 'none' } }); onConfirm(false); }}
        onValidityChange={valid => { setDeadlineValid(valid); onDateValidityChange?.(valid && publishValid); onConfirm(false); }} />
      {value.deadline && <p className="text-sm">{context.basis === 'signature' && value.deadline_inferred ? '根据落款年份补全：' : '当前：'}{shanghaiDateTime(value.deadline)}{value.deadline_inferred && <strong className="ml-2" style={{ color: 'var(--error)' }}>解析补全，待确认</strong>}</p>}
      <p className="notice notice-warning">{context.mode === 'manual' ? '已保留你手动设置的截止时间；修改发布日期或原文依据不会静默覆盖，请核对后重新确认。'
        : context.state === 'conflict' ? '日期存在冲突：请核对网页日期、正文落款及截止句中的日期或星期，再选择正确依据。'
          : context.state === 'year_required' ? '原文已发现截止日期，但年份待确认；请补充有依据的发布日期，不能使用电脑当前年份。'
            : context.state === 'invalid' ? '原文已发现日期，但日期或时分不完整或无效，请核对并修正依据。'
              : context.state === 'none' ? '未发现可识别的截止时间，请核对原文；确实不设截止时间时再明确勾选下方选项。'
                : confirmed ? '已由你对照原文确认截止时间。' : '已有原文日期依据，请核对解析补全结果后确认。'}</p>
      {(context.mode === 'manual' || !value.deadline && analyzed.deadline) && <div className="notice">解析建议：{(context.suggested_deadline || analyzed.deadline) ? shanghaiDateTime((context.suggested_deadline || analyzed.deadline)!) : '当前依据仍需补充或消除冲突'}<button type="button" className="ml-2 underline" onClick={() => reparse({}, true)}>明确采用重新解析结果</button></div>}
      <label className="field-label">日期所在原文句子<input value={value.deadline_source_text || ''} onChange={e => reparse({ deadline_source_text: e.target.value || null })} className="field" /></label>
      {deadlineEvidenceCandidates(value.source_text).length > 1 && <div className="space-y-1"><p>发现多处截止依据，请选择本事项对应的一处：</p>{deadlineEvidenceCandidates(value.source_text).map((sentence, index) => <button key={index} type="button" className="button-secondary text-left" onClick={() => reparse({ deadline_source_text: sentence })}>{sentence}</button>)}</div>}
      {value.deadline_source_text && <p className="notice notice-warning">{value.deadline_source_text}{!sourceVerified && <b className="ml-2">未在原文找到依据</b>}</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed && !!value.deadline} disabled={!value.deadline || !sourceVerified || !publishValid || !deadlineValid} onChange={e => onConfirm(e.target.checked)} />我已对照原通知确认截止时间</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed && !value.deadline} disabled={!publishValid || !deadlineValid} onChange={e => { if (e.target.checked) change({ deadline: null, deadline_inferred: false, date_context: { ...context, mode: 'manual', state: 'none' } }); onConfirm(e.target.checked); }} />我已核对原文，明确不设置截止时间</label>
    </div>
    <EventContacts value={value} onChange={onChange} />
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
