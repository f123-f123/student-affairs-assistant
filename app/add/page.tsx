'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EventEditor from '@/app/components/EventEditor';
import SiteHeader from '@/app/components/SiteHeader';
import { getDeviceId } from '@/lib/device';
import { shanghaiToday } from '@/lib/event-date';
import type { EventDraft } from '@/lib/types';

export default function AddEvent() {
  const router = useRouter();
  const [mode, setMode] = useState<'url' | 'text'>('text');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [publishDate, setPublishDate] = useState(() => shanghaiToday());
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('url');
    if (linked) { setMode('url'); setUrl(linked); }
  }, []);
  async function extract() {
    if (loading) return;
    setLoading(true); setError(''); setDraft(null); setConfirmed(false);
    try {
      const response = await fetch('/api/events/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(mode === 'url' ? { url, publish_date: publishDate } : { text, publish_date: publishDate }),
      });
      const result = await response.json() as { draft?: EventDraft; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || '提取失败');
      setDraft(result.draft);
    } catch (err) { setError(err instanceof Error ? err.message : '提取失败'); }
    finally { setLoading(false); }
  }
  async function save() {
    if (!draft || !confirmed || loading) return;
    if (draft.title === '请补充事项标题') { setError('请先根据原通知补充事项标题'); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ device_id: getDeviceId(), event: draft, deadline_confirmed: !!draft.deadline && confirmed, no_deadline_confirmed: !draft.deadline && confirmed }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      router.push('/schedule');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setLoading(false); }
  }
  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width space-y-6">
    <div className="page-head"><p className="eyebrow">我的日程 / 新事项</p><h1 className="page-title">添加事项</h1><p className="page-description">粘贴通知或输入官网链接，提取后对照原文确认，再加入日程。保存的通知原文会成为所有学生可引用的问答来源，请勿包含个人信息。</p></div>
    <div className="panel space-y-5">
      <div className="flex gap-2" role="group" aria-label="通知来源"><button type="button" onClick={() => setMode('text')} aria-pressed={mode === 'text'} className={mode === 'text' ? 'button-secondary segment-active' : 'button-secondary'}>粘贴通知</button><button type="button" onClick={() => setMode('url')} aria-pressed={mode === 'url'} className={mode === 'url' ? 'button-secondary segment-active' : 'button-secondary'}>官网链接</button></div>
      {mode === 'url' ? <label className="field-label">通知网址<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://学校官网/通知" className="field" /></label>
        : <label className="field-label">通知正文<textarea value={text} onChange={e => setText(e.target.value)} maxLength={20000} rows={9} placeholder="在这里粘贴通知全文" className="field" /></label>}
      <label className="field-label">发布日期<input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className="field max-w-xs" /></label>
      <button type="button" disabled={loading || (mode === 'url' ? !url.trim() : !text.trim())} onClick={() => void extract()} className={draft ? 'button-secondary' : 'button-primary'}>{loading ? '处理中…' : draft ? '重新提取' : '提取事项'}</button>
    </div>
    {draft && <><EventEditor value={draft} onChange={setDraft} confirmed={confirmed} onConfirm={setConfirmed} />
      <button type="button" disabled={loading || !confirmed || draft.title === '请补充事项标题'} onClick={() => void save()} className="button-primary">加入我的日程</button></>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
  </main></div>;
}
