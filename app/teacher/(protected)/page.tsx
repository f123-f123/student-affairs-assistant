'use client';

import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { useEffect, useState } from 'react';

type Ticket = { id: string; question: string; status: 'open' | 'answered'; sedimented: boolean; created_at: string; categories: { name: string } | null };

export default function TeacherHome() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  async function load() {
    setLoading(true); setError('');
    try {
      const [response, knowledge] = await Promise.all([fetch('/api/teacher/tickets', { cache: 'no-store' }), fetch('/api/teacher/knowledge/stats', { cache: 'no-store' })]);
      if (!response.ok) throw new Error();
      setTickets((await response.json() as { tickets: Ticket[] }).tickets);
      if (knowledge.ok) { const counts = await knowledge.json(); setDraftCount((counts.draft_count || 0) + (counts.import_draft_count || 0)); }
    } catch { setError('工单暂时无法加载'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const pending = tickets.filter(ticket => ticket.status === 'open');
  const answered = tickets.filter(ticket => ticket.status !== 'open');
  const ticketCard = (ticket: Ticket) => <Link key={ticket.id} href={`/teacher/tickets/${ticket.id}`} className="content-card block no-underline hover:border-current">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="muted">{ticket.categories?.name || '综合事务'} · {new Date(ticket.created_at).toLocaleString('zh-CN')}</span><span className={ticket.status === 'open' ? 'pill pill-warning' : 'pill'}>{ticket.status === 'open' ? '待回复' : '已回复'}{ticket.sedimented ? ' · 已入库' : ''}</span></div>
    <p className="mt-3 whitespace-pre-wrap font-medium" style={{ color: 'var(--text)' }}>{ticket.question}</p>
  </Link>;
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width">
    <div className="page-head"><p className="eyebrow">老师工作台</p><h1 className="page-title">待办工作</h1><p className="page-description">先处理学生工单和待审核草稿。</p></div>
    <div className="grid gap-3 sm:grid-cols-2 mb-6"><a href="#pending-tickets" className="content-card no-underline"><b className="block text-lg">待回复工单</b><span className="text-2xl">{pending.length}</span></a><Link href="/teacher/knowledge#knowledge-items" className="content-card no-underline"><b className="block text-lg">待审核知识</b><span className="text-2xl">{draftCount ?? '—'}</span><span className="block text-sm">核对依据后发布 ↗</span></Link></div>
    {error && <div role="alert" className="notice notice-error mb-4">{error} <button type="button" className="underline" onClick={() => void load()}>重试</button></div>}
    {loading ? <div className="skeleton" role="status" aria-label="正在加载工单" /> : <div className="space-y-6"><section id="pending-tickets" className="space-y-3"><h2>待回复工单（{pending.length}）</h2>{pending.map(ticketCard)}{!pending.length && <p className="notice">目前没有待回复工单。</p>}</section><section className="space-y-3"><h2>已回复工单</h2>{answered.map(ticketCard)}</section>
    {!tickets.length && !error && <div className="empty-state"><h2>暂无工单</h2><p>学生提交的问题会显示在这里。</p></div>}</div>}
  </main></div>;
}
