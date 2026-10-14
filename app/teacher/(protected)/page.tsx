'use client';

import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { useEffect, useState } from 'react';

type Ticket = { id: string; question: string; status: 'open' | 'answered'; sedimented: boolean; created_at: string; categories: { name: string } | null };

export default function TeacherHome() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => {
    try {
      const response = await fetch('/api/teacher/tickets', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setTickets((await response.json() as { tickets: Ticket[] }).tickets);
    } catch { setError('工单暂时无法加载'); }
    finally { setLoading(false); }
  })(); }, []);
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width">
    <div className="page-head"><p className="eyebrow">老师工作台</p><h1 className="page-title">学生工单</h1><p className="page-description">待回复优先，同一状态按提交时间倒序。</p></div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {loading ? <div className="skeleton" role="status" aria-label="正在加载工单" /> : <div className="space-y-3">{tickets.map(ticket => <Link key={ticket.id} href={`/teacher/tickets/${ticket.id}`} className="content-card block no-underline hover:border-current">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="muted">{ticket.categories?.name || '综合事务'} · {new Date(ticket.created_at).toLocaleString('zh-CN')}</span><span className={ticket.status === 'open' ? 'pill pill-warning' : 'pill'}>{ticket.status === 'open' ? '待回复' : '已回复'}{ticket.sedimented ? ' · 已入库' : ''}</span></div>
      <p className="mt-3 whitespace-pre-wrap font-medium" style={{ color: 'var(--text)' }}>{ticket.question}</p>
    </Link>)}
    {!tickets.length && !error && <div className="empty-state"><h2>暂无工单</h2><p>学生提交的问题会显示在这里。</p></div>}</div>}
  </main></div>;
}
