'use client';

import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { useEffect, useState } from 'react';
import { getDeviceId } from '@/lib/device';

type Ticket = { id: string; question: string; status: 'open' | 'answered'; teacher_reply: string | null; sedimented: boolean; created_at: string; answered_at: string | null; categories: { name: string } | null };

export default function MyTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/tickets?device_id=${getDeviceId()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const data = await response.json() as { tickets: Ticket[] };
        if (active) { setTickets(data.tickets); setError(''); setLoading(false); }
      } catch { if (active) { setError('工单暂时无法加载，请稍后重试'); setLoading(false); } }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width">
    <div className="page-head"><p className="eyebrow">问题追踪</p><h1 className="page-title">我的工单</h1><p className="page-description">仅显示此浏览器提交的问题，回复状态每 5 秒更新一次。</p></div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {loading ? <div className="skeleton" role="status" aria-label="正在加载工单" /> : <div className="space-y-4">{tickets.map(ticket => <article key={ticket.id} className="content-card">
      <div className="flex flex-wrap justify-between gap-2"><span className="muted text-sm">{ticket.categories?.name || '综合事务'} · {new Date(ticket.created_at).toLocaleString('zh-CN')}</span>
        <span className={ticket.status === 'answered' ? 'pill' : 'pill pill-warning'}>{ticket.status === 'answered' ? '已回复' : '待回复'}</span></div>
      <p className="mt-3 whitespace-pre-wrap font-medium">{ticket.question}</p>
      {ticket.teacher_reply && <div className="notice mt-4"><b>老师回复</b><p className="mt-1 whitespace-pre-wrap">{ticket.teacher_reply}</p>
        {ticket.answered_at && <span className="muted text-xs">{new Date(ticket.answered_at).toLocaleString('zh-CN')}</span>}</div>}
      {ticket.sedimented && <p className="mt-3 text-sm font-medium" style={{ color: 'var(--success)' }}>该回答已被收录进知识库</p>}
    </article>)}
    {!tickets.length && !error && <div className="empty-state"><h2>还没有工单</h2><p>问答里没有找到答案时，可以提交给老师。</p><Link href="/" className="button-primary">去提问</Link></div>}</div>}
  </main></div>;
}
