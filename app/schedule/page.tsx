'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import EventEditor from '@/app/components/EventEditor';
import SiteHeader from '@/app/components/SiteHeader';
import { shanghaiDateTime } from '@/lib/event-date';
import { eventStateLabels, getEventState, matchesScheduleFilter, scheduleFilters, type ScheduleFilter } from '@/lib/schedule';
import type { EventDraft, EventMaterial, StudentEvent } from '@/lib/types';

function editable(item: StudentEvent): EventDraft {
  const { id, device_id, status, created_at, updated_at, ...draft } = item;
  return draft;
}

export default function Schedule() {
  const [items, setItems] = useState<StudentEvent[]>([]);
  const [editing, setEditing] = useState<{ id: string; draft: EventDraft } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [now, setNow] = useState(Date.now);
  const [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/events', { cache: 'no-store' });
    if (!response.ok) throw new Error('日程加载失败');
    const result = await response.json() as { events: StudentEvent[] };
    setItems(result.events);
    setLoading(false);
  }, []);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('saved') === '1') setFeedback('事项已加入我的日程'); void load().catch(err => { setError(err.message); setLoading(false); }); }, [load]);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  async function update(id: string, body: object) {
    if (busy) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const response = await fetch(`/api/events/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '更新失败');
      await load(); setEditing(null); setFeedback('事项已更新');
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (busy || !window.confirm('确定删除这个事项？')) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const response = await fetch(`/api/events/${id}`, { method: 'DELETE', cache: 'no-store' });
      if (!response.ok) throw new Error('删除失败');
      await load(); setFeedback('事项已删除');
    } catch (err) { setError(err instanceof Error ? err.message : '删除失败'); }
    finally { setBusy(false); }
  }
  function checkMaterial(item: StudentEvent, index: number) {
    const materials: EventMaterial[] = item.materials.map((entry, i) => i === index ? { ...entry, done: !entry.done } : entry);
    void update(item.id, { materials });
  }
  const exportUrl = (id?: string) => `/api/events/export${id ? `?id=${id}` : ''}`;
  const visible = items.filter(item => matchesScheduleFilter(item, filter, now));
  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width">
    <div className="page-head flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">我的事项</p><h1 className="page-title">我的日程</h1><p className="page-description">以截止事项为主，逐项核对材料与办理进度。</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/add" className="button-primary">添加事项</Link>{items.some(item => item.deadline && item.status === 'active') && <a href={exportUrl()} className="button-secondary">导出日历 .ics</a>}</div></div>
    {feedback && <p role="status" className="notice mb-4">{feedback}</p>}
    {error && <div role="alert" className="notice notice-error mb-5">{error} <button type="button" className="underline" onClick={() => void load().then(() => setError('')).catch(err => setError(err.message))}>重试</button></div>}
    {!loading && <><div className="filter-row mb-2" role="group" aria-label="筛选事项">{scheduleFilters.map(([value, label]) => <button key={value} type="button" className={filter === value ? 'button-secondary segment-active' : 'button-secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}（{items.filter(item => matchesScheduleFilter(item, value, now)).length}）</button>)}</div>
      <p className="muted mb-5 text-sm">“进行中”包含所有未完成、未归档事项；未设置截止时间的事项也可在“无截止时间”查看。“7 天内截止”和“已过期”仅筛选有截止时间的进行中事项。</p></>}
    {loading ? <div className="skeleton" role="status" aria-label="正在加载日程" /> : <div className="space-y-4">{visible.map(item => {
      const done = item.materials.filter(material => material.done).length;
      const state = getEventState(item, now);
      return <article key={item.id} className="content-card">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-xl font-semibold">{item.title}</h2><span className={`pill ${state === 'overdue' ? 'pill-error' : state === 'soon' ? 'pill-warning' : ''}`}>{eventStateLabels[state]}</span></div>
        <p className="muted mt-2 text-sm">{item.deadline ? `截止：${shanghaiDateTime(item.deadline)}（上海时间）` : '无截止时间'}{item.deadline_inferred && ' · 由相对日期推算'}</p>
        {(item.publish_date || item.source_fetched_at || item.source_confirmed_at) && <p className="muted mt-1 text-sm">发布时间：{item.publish_date || '未确认'} · 获取时间：{item.source_fetched_at ? shanghaiDateTime(item.source_fetched_at) : '手动录入'} · 确认时间：{item.source_confirmed_at ? shanghaiDateTime(item.source_confirmed_at) : '历史事项未记录'}</p>}
        {item.summary && <p className="mt-2 text-sm">{item.summary}</p>}
        {item.eligibility && <p className="mt-1 text-sm">适用：{item.eligibility}</p>}
        {item.submit_to && <p className="mt-1 text-sm">提交：{item.submit_to}</p>}
        {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-sm">查看原通知 ↗</a>}
        <div className="mt-4 border-t pt-4 text-sm" style={{ borderColor: 'var(--border)' }}><b>材料进度：{done}/{item.materials.length}</b>
          {item.materials.map((material, index) => <label key={index} className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={material.done} disabled={busy} onChange={() => checkMaterial(item, index)} />{material.name}</label>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
            {item.deadline && item.status === 'active' && <a href={exportUrl(item.id)} className="button-secondary">导出 .ics</a>}
          <button type="button" disabled={busy} onClick={() => { setEditing({ id: item.id, draft: editable(item) }); setConfirmed(false); }} className="button-secondary">编辑</button>
          <button type="button" disabled={busy} onClick={() => void update(item.id, { status: item.status === 'done' ? 'active' : 'done' })} className="button-quiet">{item.status === 'done' ? '重启' : '标记完成'}</button>
          <button type="button" disabled={busy} onClick={() => void update(item.id, { status: item.status === 'archived' ? 'active' : 'archived' })} className="button-quiet">{item.status === 'archived' ? '取消归档' : '归档'}</button>
          <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="button-quiet" style={{ color: 'var(--error)' }}>删除</button>
        </div>
      </article>;
    })}
    {!visible.length && !error && <div className="empty-state"><h2>{items.length ? '这个筛选下没有事项' : '日程还是空的'}</h2><p>{items.length ? '可以切换筛选查看其他事项。' : '从一条通知开始，整理截止时间和所需材料。'}</p><Link href="/add" className="button-primary">添加事项</Link></div>}</div>}
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <div className="modal-panel space-y-4"><h2 id="edit-title" className="text-xl font-bold">编辑事项</h2>
        <EventEditor value={editing.draft} onChange={draft => setEditing({ ...editing, draft })} confirmed={confirmed} onConfirm={setConfirmed} />
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="button-quiet">取消</button>
          <button type="button" disabled={busy || !confirmed} onClick={() => void update(editing.id, { event: editing.draft, deadline_confirmed: !!editing.draft.deadline && confirmed, no_deadline_confirmed: !editing.draft.deadline && confirmed })} className="button-primary">保存修改</button></div>
      </div>
    </div>}
  </main></div>;
}
