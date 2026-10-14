'use client';

import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type Ticket = { id: string; question: string; category_id: string | null; status: 'open' | 'answered'; teacher_reply: string | null; sedimented: boolean; knowledge_item_id: string | null; created_at: string; answered_at: string | null };
type Category = { id: string; name: string };
type Item = { id: string; category_id: string; question: string; answer: string; updated_at: string };
type Detail = { ticket: Ticket; categories: Category[]; items: Item[] };

export default function TeacherTicket() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/teacher/tickets/${id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('工单加载失败');
    const data = await response.json() as Detail;
    setDetail(data);
    setReply(data.ticket.teacher_reply || '');
    setCategoryId(current => current || data.ticket.category_id || data.categories.find(c => c.name === '综合事务')?.id || '');
  }, [id]);
  useEffect(() => { void load().catch(err => setMessage(err.message)); }, [load]);

  async function send(path: string, method: 'PUT' | 'POST', body?: object) {
    const response = await fetch(`/api/teacher/tickets/${id}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');
    return data;
  }
  async function saveReply() {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await send('/reply', 'PUT', { reply }); await load(); setMessage('回复已保存'); }
    catch (err) { setMessage(err instanceof Error ? err.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function generateDraft() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const data = await send('/draft', 'POST') as { draft: { question: string; answer: string } };
      setDraftQuestion(data.draft.question); setDraftAnswer(data.draft.answer);
      setMessage('草稿已生成，请核对并编辑后确认入库');
    } catch (err) { setMessage(err instanceof Error ? err.message : '生成失败'); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (busy || !draftQuestion.trim() || !draftAnswer.trim()) return;
    setBusy(true); setMessage('');
    try {
      await send('/confirm', 'POST', { question: draftQuestion, answer: draftAnswer, category_id: categoryId, supersedes: supersedes || null });
      await load(); setMessage('已确认入库，下次提问会实时读取新条目');
    } catch (err) { setMessage(err instanceof Error ? err.message : '入库失败'); }
    finally { setBusy(false); }
  }
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width">
    <Link href="/teacher" className="button-quiet mb-6">← 返回工单列表</Link>
    {!detail ? message ? <p role="alert" className="notice notice-error">{message}</p> : <div className="skeleton" role="status" aria-label="正在加载工单" /> : <div className="space-y-6">
      <section className="page-head"><p className="eyebrow">工单处理</p><h1 className="page-title">工单详情</h1>
        <p className="page-description">{new Date(detail.ticket.created_at).toLocaleString('zh-CN')} · {detail.ticket.status === 'open' ? '待回复' : '已回复'}</p>
        <p className="notice mt-5 whitespace-pre-wrap">{detail.ticket.question}</p></section>
      <section className="panel space-y-4"><h2 className="text-xl font-semibold">老师回复</h2>
        <label className="field-label">回复内容<textarea value={reply} onChange={event => setReply(event.target.value)} maxLength={4000} rows={6} className="field" placeholder="输入回复" /></label>
        <button type="button" disabled={busy || !reply.trim()} onClick={() => void saveReply()} className={detail.ticket.status === 'answered' ? 'button-secondary' : 'button-primary'}>{busy ? '处理中…' : '保存回复'}</button>
        {detail.ticket.sedimented && <p className="notice notice-warning">此工单已入库；修改回复不会自动修改已确认知识条目。</p>}
      </section>
      <section className="panel space-y-4"><h2 className="text-xl font-semibold">沉淀入知识库</h2>
        {detail.ticket.sedimented ? <p className="notice">已入库，知识条目 ID：{detail.ticket.knowledge_item_id}</p> : <>
          <button type="button" disabled={busy || detail.ticket.status !== 'answered'} onClick={() => void generateDraft()} className="button-secondary">生成问答草稿</button>
          <p className="muted text-sm">请核对草稿，删除任何姓名、学号、电话等个人信息。也可直接手工填写。</p>
          <label className="field-label">通用问题<textarea value={draftQuestion} onChange={event => setDraftQuestion(event.target.value)} maxLength={500} rows={2} className="field" /></label>
          <label className="field-label">通用答案<textarea value={draftAnswer} onChange={event => setDraftAnswer(event.target.value)} maxLength={4000} rows={5} className="field" /></label>
          <label className="field-label">类别<select value={categoryId} onChange={event => { setCategoryId(event.target.value); setSupersedes(''); }} className="field">
            {detail.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <div><label className="field-label">替换已有已确认条目（可选）<select value={supersedes} onChange={event => setSupersedes(event.target.value)} className="field">
            <option value="">不替换</option>{detail.items.filter(item => item.category_id === categoryId).map(item => <option key={item.id} value={item.id}>{item.question}</option>)}
          </select></label>
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto text-sm">{detail.items.filter(item => item.category_id === categoryId).map(item => <p key={item.id} className="notice"><b>{item.question}</b>：{item.answer}</p>)}</div>
          </div>
          <button type="button" disabled={busy || detail.ticket.status !== 'answered' || !draftQuestion.trim() || !draftAnswer.trim()} onClick={() => void confirm()} className="button-primary">{busy ? '处理中…' : '确认入库'}</button>
        </>}
      </section>
      {message && <p role="status" className="notice">{message}</p>}
    </div>}
  </main></div>;
}
