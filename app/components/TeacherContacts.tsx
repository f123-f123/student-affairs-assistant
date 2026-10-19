'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Contact, NoticeContactCandidate } from '@/lib/types';
import ContactCard from './ContactCard';

type Row = Contact & { category_id: string; scope?: 'category' | 'notice'; source_excerpt?: string; notice_event_id?: string };
export type ContactsState = { contacts: Row[]; loading: boolean; error: string };
const empty = { name: '', role: 'teacher' as Contact['role'], phone: '', email: '', office: '', office_hours: '', category_id: '' };

export function CategoryContacts({ state, categoryId }: { state: ContactsState; categoryId: string }) {
  const rows = state.contacts.filter(contact => contact.category_id === categoryId);
  return <div className="space-y-2" aria-label="该类别现有负责人"><h3>该类别现有负责人</h3>
    {state.loading ? <p role="status">正在读取负责人…</p> : state.error ? <p role="alert" className="notice notice-error">{state.error}</p> : rows.length ? rows.map(contact => <ContactCard key={contact.id} contact={contact} />) : <p className="notice notice-warning">该类别尚未配置负责人</p>}
    <p className="muted text-sm">发布知识不会自动关联当前老师。负责人按类别独立维护。<a href="#contact-manager">维护负责人</a></p>
  </div>;
}

export default function TeacherContacts({ categories, categoryId, onChange }: {
  categories: { id: string; name: string }[]; categoryId: string; onChange: (state: ContactsState) => void;
}) {
  const [state, setState] = useState<ContactsState>({ contacts: [], loading: true, error: '' });
  const [value, setValue] = useState(empty);
  const [editing, setEditing] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState<'category' | 'notice'>('category');
  const [noticeEvents, setNoticeEvents] = useState<{ id: string; title: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [noticeRows, setNoticeRows] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<NoticeContactCandidate[]>([]);
  const [sourceExcerpt, setSourceExcerpt] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);
  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const response = await fetch('/api/teacher/contacts', { cache: 'no-store' });
      if (!response.ok) throw new Error('负责人读取失败，请重试；不能据此判断尚未配置');
      const { contacts } = await response.json() as { contacts: Row[] };
      const next = { contacts, loading: false, error: '' }; setState(next); onChange(next);
    } catch (error) {
      const next = { contacts: [], loading: false, error: error instanceof Error ? error.message : '负责人读取失败' };
      setState(next); onChange(next);
    }
  }, [onChange]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!editing) setValue({ ...empty, category_id: scope === 'category' ? categoryId : '' }); }, [categoryId, editing, scope]);
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('event_id');
    if (linked) { setScope('notice'); setEventId(linked); }
  }, []);
  useEffect(() => {
    if (scope !== 'notice') return;
    const controller = new AbortController();
    void fetch('/api/teacher/contacts/events', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('通知事项列表读取失败');
      setNoticeEvents((await response.json()).events);
    }).catch(error => { if (!controller.signal.aborted) setNoticeError(error.message); });
    return () => controller.abort();
  }, [scope]);
  const loadNotice = useCallback(async (id: string, signal?: AbortSignal) => {
    setNoticeLoading(true); setNoticeError(''); setNoticeRows([]); setCandidates([]); setSourceConfirmed(false);
    try {
      const response = await fetch(`/api/teacher/contacts?event_id=${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '本通知联系人读取失败');
      if (signal?.aborted) return;
      setNoticeRows(result.contacts); setCandidates(result.candidates);
    } catch (error) { if (!signal?.aborted) setNoticeError(error instanceof Error ? error.message : '本通知联系人读取失败'); }
    finally { if (!signal?.aborted) setNoticeLoading(false); }
  }, []);
  useEffect(() => {
    if (scope !== 'notice' || !eventId) {
      setNoticeRows([]); setCandidates([]); setNoticeLoading(false); setNoticeError(''); setSourceConfirmed(false);
      return;
    }
    const controller = new AbortController(); void loadNotice(eventId, controller.signal);
    return () => controller.abort();
  }, [scope, eventId, loadNotice]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/contacts', { method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...value, scope, ...(scope === 'notice' ? { notice_event_id: eventId, source_excerpt: sourceExcerpt, confirm_source: sourceConfirmed } : {}), ...(editing ? { id: editing } : {}) }), cache: 'no-store' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      setEditing(''); setValue({ ...empty, category_id: scope === 'category' ? categoryId : '' });
      if (scope === 'notice') { await loadNotice(eventId); setMessage('本通知联系人已保存并关联到该事项；不会成为整个类别的咨询负责人。'); }
      else { await load(); setMessage('负责人已保存。新问答及重新打开的历史对话将使用当前资料。'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <section id="contact-manager" className="panel space-y-4"><h2 className="font-semibold">负责人维护</h2>
    <div className="filter-row" role="group" aria-label="联系人作用范围">{([['category', '类别咨询负责人'], ['notice', '本通知联系人']] as const).map(([kind, label]) => <button key={kind} type="button" className={scope === kind ? 'button-secondary segment-active' : 'button-secondary'} aria-pressed={scope === kind} disabled={saving} onClick={() => { setScope(kind); setEditing(''); setSourceExcerpt(''); setSourceConfirmed(false); setMessage(''); }}>{label}</button>)}</div>
    <p className="muted text-sm">仅老师可维护。请填写核实过的资料；没有真实资料时留空，不编造负责人。演示记录必须在姓名中明确标注“演示”，不会提供拨号或邮件按钮。</p>
    {scope === 'notice' && <div className="space-y-3"><p className="notice">只关联所选通知事项，不作为同类别其他事务的负责人。请对照原文核对后确认。</p><label className="field-label">选择已保存的通知事项<select className="field" value={eventId} onChange={event => { setEventId(event.target.value); setEditing(''); setValue({ ...empty }); setSourceExcerpt(''); }}><option value="">请选择通知</option>{noticeEvents.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
      {noticeLoading && <p role="status">正在读取本通知依据…</p>}{noticeError && <p role="alert" className="notice notice-error">{noticeError}</p>}
      {candidates.map((candidate, index) => <div key={index} className="notice"><b>原文候选：{candidate.name || '未署名'}</b><p>{candidate.email || candidate.phone}</p><p>依据：{candidate.source_excerpt}</p><button type="button" className="button-secondary" disabled={!candidate.name || !candidate.role} onClick={() => {
        setValue({ ...empty, category_id: value.category_id, name: candidate.name, role: candidate.role!, email: candidate.email || '', phone: candidate.phone || '' }); setSourceExcerpt(candidate.source_excerpt); setSourceConfirmed(false);
      }}>采用此原文候选</button></div>)}
    </div>}
    {scope === 'category' && state.error && <p role="alert" className="notice notice-error">{state.error} <button type="button" className="underline" onClick={() => void load()}>重试</button></p>}
    {scope === 'category' && !state.loading && !state.error && !state.contacts.length && <p className="notice notice-warning">尚未配置负责人，可在下方新增。</p>}
    {(scope === 'notice' ? noticeRows : state.contacts).map(contact => <div key={contact.id} className="space-y-1"><p className="muted">{scope === 'notice' ? '仅本通知' : categories.find(category => category.id === contact.category_id)?.name || '类别待确认'}</p><ContactCard contact={contact} /><button type="button" className="button-secondary" disabled={saving} onClick={() => {
      setEditing(contact.id); setValue({ category_id: contact.category_id, name: contact.name, role: contact.role, phone: contact.phone || '', email: contact.email || '', office: contact.office || '', office_hours: contact.office_hours || '' }); setMessage('');
      setSourceExcerpt(contact.source_excerpt || ''); setSourceConfirmed(false);
    }}>编辑负责人</button></div>)}
    <form onSubmit={event => void save(event)} className="space-y-3"><h3>{editing ? '编辑负责人' : '新增负责人'}</h3>
      <label className="field-label">负责人类别<select className="field" value={value.category_id} onChange={event => setValue({ ...value, category_id: event.target.value })} required><option value="">请选择类别</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="field-label">姓名<input className="field" value={value.name} maxLength={80} required onChange={event => { setValue({ ...value, name: event.target.value }); setSourceConfirmed(false); }} /></label>
      <label className="field-label">角色<select className="field" value={value.role} onChange={event => { setValue({ ...value, role: event.target.value as Contact['role'] }); setSourceConfirmed(false); }}><option value="teacher">老师</option><option value="student_leader">学生负责人</option></select></label>
      {([['phone', '电话', 'tel'], ['email', '邮箱', 'email'], ['office', '办公地点', 'text'], ['office_hours', '办公时间', 'text']] as const).filter(([field]) => scope === 'category' || field === 'phone' || field === 'email').map(([field, label, type]) => <label key={field} className="field-label">{label}（可选）<input className="field" type={type} value={value[field]} maxLength={field === 'email' ? 254 : field === 'phone' ? 50 : 200} onChange={event => { setValue({ ...value, [field]: event.target.value }); setSourceConfirmed(false); }} /></label>)}
      {scope === 'notice' && <><p className="notice whitespace-pre-wrap">原文依据：{sourceExcerpt || '请先采用原文候选'}</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={sourceConfirmed} disabled={!sourceExcerpt} onChange={event => setSourceConfirmed(event.target.checked)} />我已核对该通知中的姓名、角色和联系方式，仅关联本事项</label></>}
      <div className="flex gap-2"><button className="button-primary" type="submit" disabled={saving || (scope === 'category' ? state.loading || !!state.error : noticeLoading || !!noticeError || !eventId || !sourceConfirmed)}>{saving ? '保存中…' : '保存负责人'}</button>{editing && <button type="button" className="button-secondary" onClick={() => setEditing('')}>取消编辑</button>}</div>
      {message && <p role="status" className="notice">{message}</p>}
    </form>
  </section>;
}
