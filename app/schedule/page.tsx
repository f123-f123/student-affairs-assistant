'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import EventEditor from '@/app/components/EventEditor';
import SiteHeader from '@/app/components/SiteHeader';
import { getDeviceId } from '@/lib/device';
import { shanghaiDateTime } from '@/lib/event-date';
import type { EventDraft, EventMaterial, StudentEvent } from '@/lib/types';

function urgency(item: StudentEvent): string {
  if (!item.deadline || item.status !== 'active') return '';
  const days = (new Date(item.deadline).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'pill-error';
  if (days <= 7) return 'pill-warning';
  return '';
}

function editable(item: StudentEvent): EventDraft {
  return {
    title: item.title, summary: item.summary, eligibility: item.eligibility, deadline: item.deadline,
    deadline_source_text: item.deadline_source_text, deadline_inferred: item.deadline_inferred,
    submit_to: item.submit_to, materials: item.materials, source_url: item.source_url,
    source_text: item.source_text, publish_date: item.publish_date,
  };
}

export default function Schedule() {
  const [items, setItems] = useState<StudentEvent[]>([]);
  const [editing, setEditing] = useState<{ id: string; draft: EventDraft } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const response = await fetch(`/api/events?device_id=${getDeviceId()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('日程加载失败');
    const result = await response.json() as { events: StudentEvent[] };
    setItems(result.events);
    setLoading(false);
  }, []);
  useEffect(() => { void load().catch(err => { setError(err.message); setLoading(false); }); }, [load]);

  async function update(id: string, body: object) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/events/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ device_id: getDeviceId(), ...body }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '更新失败');
      await load(); setEditing(null);
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (busy || !window.confirm('确定删除这个事项？')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/events/${id}?device_id=${getDeviceId()}`, { method: 'DELETE', cache: 'no-store' });
      if (!response.ok) throw new Error('删除失败');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '删除失败'); }
    finally { setBusy(false); }
  }
  function checkMaterial(item: StudentEvent, index: number) {
    const materials: EventMaterial[] = item.materials.map((entry, i) => i === index ? { ...entry, done: !entry.done } : entry);
    void update(item.id, { materials });
  }
  const exportUrl = (id?: string) => `/api/events/export?device_id=${getDeviceId()}${id ? `&id=${id}` : ''}`;
  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width">
    <div className="page-head flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">我的事项</p><h1 className="page-title">我的日程</h1><p className="page-description">按截止时间排列，逐项核对材料与办理进度。</p></div>
      {items.some(item => item.deadline && item.status !== 'archived') && <a href={exportUrl()} className="button-secondary">导出日历 .ics</a>}</div>
    {error && <p role="alert" className="notice notice-error mb-5">{error}</p>}
    {loading ? <div className="skeleton" role="status" aria-label="正在加载日程" /> : <div className="space-y-4">{items.map(item => {
      const done = item.materials.filter(material => material.done).length;
      return <article key={item.id} className="content-card">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-xl font-semibold">{item.title}</h2><span className={`pill ${urgency(item)}`}>{item.status === 'active' ? '进行中' : item.status === 'done' ? '已完成' : '已归档'}</span></div>
        <p className="muted mt-2 text-sm">{item.deadline ? `截止：${shanghaiDateTime(item.deadline)}（上海时间）` : '无截止时间'}{item.deadline_inferred && ' · 由相对日期推算'}</p>
        {item.summary && <p className="mt-2 text-sm">{item.summary}</p>}
        {item.eligibility && <p className="mt-1 text-sm">适用：{item.eligibility}</p>}
        {item.submit_to && <p className="mt-1 text-sm">提交：{item.submit_to}</p>}
        {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-sm">查看原通知 ↗</a>}
        <div className="mt-4 border-t pt-4 text-sm" style={{ borderColor: 'var(--border)' }}><b>材料进度：{done}/{item.materials.length}</b>
          {item.materials.map((material, index) => <label key={index} className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={material.done} disabled={busy} onChange={() => checkMaterial(item, index)} />{material.name}</label>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {item.deadline && item.status !== 'archived' && <a href={exportUrl(item.id)} className="button-secondary">导出 .ics</a>}
          <button type="button" disabled={busy} onClick={() => { setEditing({ id: item.id, draft: editable(item) }); setConfirmed(false); }} className="button-secondary">编辑</button>
          <button type="button" disabled={busy} onClick={() => void update(item.id, { status: item.status === 'done' ? 'active' : 'done' })} className="button-quiet">{item.status === 'done' ? '重启' : '标记完成'}</button>
          <button type="button" disabled={busy} onClick={() => void update(item.id, { status: item.status === 'archived' ? 'active' : 'archived' })} className="button-quiet">{item.status === 'archived' ? '取消归档' : '归档'}</button>
          <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="button-quiet" style={{ color: 'var(--error)' }}>删除</button>
        </div>
      </article>;
    })}
    {!items.length && !error && <div className="empty-state"><h2>日程还是空的</h2><p>从一条通知开始，整理截止时间和所需材料。</p><Link href="/add" className="button-primary">添加事项</Link></div>}</div>}
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <div className="modal-panel space-y-4"><h2 id="edit-title" className="text-xl font-bold">编辑事项</h2>
        <EventEditor value={editing.draft} onChange={draft => setEditing({ ...editing, draft })} confirmed={confirmed} onConfirm={setConfirmed} />
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="button-quiet">取消</button>
          <button type="button" disabled={busy || !confirmed} onClick={() => void update(editing.id, { event: editing.draft, deadline_confirmed: !!editing.draft.deadline && confirmed, no_deadline_confirmed: !editing.draft.deadline && confirmed })} className="button-primary">保存修改</button></div>
      </div>
    </div>}
  </main></div>;
}
