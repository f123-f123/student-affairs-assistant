'use client';

import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isTicketDetail, isTicketCandidate, record, replyVersion, type TicketDetail, type TicketCandidate } from '@/lib/ticket-contract';

class RequestError extends Error {
  constructor(message: string, readonly status = 0, readonly code = 'TICKET_NETWORK_ERROR') { super(message); }
}
async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  if (!record(data)) throw new RequestError('响应结构异常，请读取最新状态后再操作', response.status, 'TICKET_RESPONSE_INVALID');
  if (!response.ok) throw new RequestError(typeof data.error === 'string' ? data.error : '操作失败', response.status, typeof data.code === 'string' ? data.code : 'TICKET_REQUEST_FAILED');
  return data;
}

export default function TeacherTicket() {
  const { id } = useParams<{ id: string }>();
  return <TicketEditor key={id} id={id} />;
}
function TicketEditor({ id }: { id: string }) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const replyRef = useRef('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [publicExcerpt, setPublicExcerpt] = useState('');
  const [publicReviewed, setPublicReviewed] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<TicketDetail | null>(null);
  const [binding, setBinding] = useState<{ reply_version: number; reply_fingerprint: string; reply: string } | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateRetry, setCandidateRetry] = useState(0);
  const [candidates, setCandidates] = useState<TicketCandidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');

  function invalidateDraft() { setBinding(null); setPublicReviewed(false); }
  function editReply(value: string) {
    if (busyRef.current) return;
    replyRef.current = value; setReply(value); invalidateDraft();
  }
  async function fetchDetail(signal?: AbortSignal) {
    const data = await readResponse(await fetch(`/api/teacher/tickets/${id}`, { cache: 'no-store', signal }));
    if (!isTicketDetail(data) || data.ticket.id !== id) throw new RequestError('工单响应结构异常，请联系管理员检查接口版本', 503, 'TICKET_RESPONSE_INVALID');
    return data;
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchDetail(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setDetail(data); replyRef.current = data.ticket.teacher_reply || ''; setReply(replyRef.current);
      setCategoryId(data.ticket.category_id || data.categories.find(c => c.name === '综合事务')?.id || data.categories[0]?.id || '');
    }).catch(error => { if (!controller.signal.aborted) showError(error); });
    return () => controller.abort();
    // id 的变化通过组件 key 重建编辑状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!showCandidates || !categoryId) return;
    const controller = new AbortController();
    setCandidateLoading(true); setCandidateError(''); setCandidates([]);
    void (async () => {
      try {
        const data = await readResponse(await fetch(`/api/teacher/ticket-candidates?category_id=${categoryId}&page=${candidatePage}`, { cache: 'no-store', signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (data.category_id !== categoryId || data.page !== candidatePage || !Array.isArray(data.items) || !data.items.every(isTicketCandidate) ||
          data.items.some(item => item.category_id !== categoryId) || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new RequestError('候选知识响应结构异常');
        setCandidates(data.items); setCandidateTotal(Number(data.total));
      } catch (error) { if (!controller.signal.aborted) setCandidateError(error instanceof Error ? error.message : '候选知识加载失败'); }
      finally { if (!controller.signal.aborted) setCandidateLoading(false); }
    })();
    return () => controller.abort();
  }, [categoryId, candidatePage, candidateRetry, showCandidates]);

  function begin() {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setMessage(''); return true;
  }
  function finish() { busyRef.current = false; setBusy(false); }
  function showError(error: unknown) {
    if (error instanceof RequestError && error.status === 409) { setConflict(true); setLatest(null); invalidateDraft(); }
    setMessage(error instanceof RequestError ? `${error.message}（${error.code}）` : '网络请求失败；写请求可能已完成，请先读取最新状态，当前输入已保留（TICKET_NETWORK_ERROR）');
  }
  async function send(path: string, method: 'PUT' | 'POST', body: object) {
    return readResponse(await fetch(`/api/teacher/tickets/${id}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    }));
  }
  async function saveReply() {
    if (!detail || !begin()) return;
    const submitted = replyRef.current;
    invalidateDraft();
    try {
      const data = await send('/reply', 'PUT', { reply: submitted, reply_version: detail.ticket.reply_version });
      if (!replyVersion(data.reply_version) || typeof data.teacher_reply !== 'string' || typeof data.answered_at !== 'string') throw new RequestError('保存请求已返回成功，但响应异常，请读取最新状态', 200, 'TICKET_RESPONSE_INVALID');
      // 保存成功后直接接收新版本，不重载输入框。
      setDetail(current => current && ({ ...current, ticket: { ...current.ticket, teacher_reply: data.teacher_reply as string, reply_version: data.reply_version as number, answered_at: data.answered_at as string, status: 'answered' } }));
      if (replyRef.current === submitted) { replyRef.current = data.teacher_reply; setReply(data.teacher_reply); }
      setConflict(false); setLatest(null); setMessage('回复已保存，旧草稿已失效');
    } catch (error) { showError(error); }
    finally { finish(); }
  }
  async function generateDraft() {
    if (!detail || replyRef.current !== detail.ticket.teacher_reply || !begin()) return;
    const submitted = replyRef.current;
    invalidateDraft();
    try {
      const data = await send('/draft', 'POST', { reply: submitted, reply_version: detail.ticket.reply_version });
      if (!record(data.draft) || typeof data.draft.question !== 'string' || typeof data.draft.answer !== 'string' ||
        data.reply_version !== detail.ticket.reply_version || typeof data.reply_fingerprint !== 'string' || !data.reply_fingerprint) throw new RequestError('草稿响应结构异常', 503, 'TICKET_RESPONSE_INVALID');
      if (replyRef.current !== submitted) return;
      setDraftQuestion(data.draft.question); setDraftAnswer(data.draft.answer); setPublicExcerpt('');
      setBinding({ reply_version: detail.ticket.reply_version, reply_fingerprint: data.reply_fingerprint, reply: submitted });
      setMessage('草稿已生成，请审核将向学生公开的全部内容');
    } catch (error) { showError(error); }
    finally { finish(); }
  }
  async function confirm() {
    if (!detail || !binding || !publicReviewed || binding.reply !== replyRef.current || replyRef.current !== detail.ticket.teacher_reply || binding.reply_version !== detail.ticket.reply_version || !begin()) return;
    let committed = false;
    try {
      const data = await send('/confirm', 'POST', { question: draftQuestion, answer: draftAnswer, category_id: categoryId, supersedes: supersedes || null,
        reply_version: binding.reply_version, reply_fingerprint: binding.reply_fingerprint, public_excerpt: publicExcerpt.trim() || null, public_reviewed: true });
      committed = true; invalidateDraft();
      setDetail(current => current && ({ ...current, ticket: { ...current.ticket, sedimented: true, knowledge_item_id: typeof data.knowledge_item_id === 'string' ? data.knowledge_item_id : current.ticket.knowledge_item_id } }));
      const fresh = await fetchDetail(); setDetail(fresh);
      setMessage('已确认入库，下次提问会实时读取新条目');
    } catch (error) {
      if (committed) setMessage('入库已成功，但详情刷新失败；请读取最新状态，勿重复入库。当前输入已保留');
      else showError(error);
    } finally { finish(); }
  }
  async function compareLatest() {
    if (!begin()) return;
    try { const data = await fetchDetail(); setLatest(data); setMessage('最新回复已读取，当前输入未覆盖；请对照后决定如何继续'); }
    catch (error) { showError(error); }
    finally { finish(); }
  }
  function useLatest(keepInput: boolean) {
    if (!latest || busyRef.current) return;
    setDetail(latest); invalidateDraft(); setConflict(false);
    if (!keepInput) { replyRef.current = latest.ticket.teacher_reply || ''; setReply(replyRef.current); }
    if (!categoryId) setCategoryId(latest.ticket.category_id || latest.categories[0]?.id || '');
    setLatest(null); setMessage(keepInput ? '已更新版本并保留当前输入，请核对后重新保存' : '已采用最新回复，旧草稿已失效');
  }
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width">
    <Link href="/teacher" className="button-quiet mb-6">← 返回工单列表</Link>
    {!detail ? <><p role="status">{message || '正在加载工单…'}</p><button onClick={() => void compareLatest()} disabled={busy} className="button-secondary">重试读取</button>{latest && <button onClick={() => useLatest(false)}>打开工单</button>}</> : <div className="space-y-6">
      <section className="page-head"><p className="eyebrow">工单处理</p><h1 className="page-title">工单详情</h1>
        <p className="page-description">{new Date(detail.ticket.created_at).toLocaleString('zh-CN')} · {detail.ticket.status === 'open' ? '待回复' : '已回复'} · 回复版本 {detail.ticket.reply_version}</p>
        <p className="notice mt-5 whitespace-pre-wrap">{detail.ticket.question}</p></section>
      <fieldset disabled={busy} className="panel space-y-4"><legend className="text-xl font-semibold">老师回复（仅工单内部）</legend>
        <label className="field-label">回复内容<textarea disabled={busy} value={reply} onChange={event => editReply(event.target.value)} maxLength={4000} rows={6} className="field" placeholder="输入回复" /></label>
        <button type="button" disabled={busy || conflict || !reply.trim()} onClick={() => void saveReply()} className="button-primary">{busy ? '处理中…' : '保存回复'}</button>
        {detail.ticket.sedimented && <p className="notice notice-warning">此工单已入库；修改回复不会自动修改已确认知识条目。</p>}
      </fieldset>
      <fieldset disabled={busy} className="panel space-y-4"><legend className="text-xl font-semibold">审核将向学生公开的内容</legend>
        {detail.ticket.sedimented ? <p className="notice">已入库，知识条目 ID：{detail.ticket.knowledge_item_id}</p> : <>
          <button type="button" disabled={busy || conflict || detail.ticket.status !== 'answered' || reply !== detail.ticket.teacher_reply} onClick={() => void generateDraft()} className="button-secondary">生成问答草稿</button>
          <p className="muted text-sm">先保存回复再生成。内部回复不会自动公开。模型与规则只能辅助处理，请人工核对问题、答案和依据中的身份信息与个人办理结果。</p>
          <label className="field-label">公开问题<textarea value={draftQuestion} onChange={e => { setDraftQuestion(e.target.value); setPublicReviewed(false); }} maxLength={500} rows={2} className="field" /></label>
          <label className="field-label">公开答案<textarea value={draftAnswer} onChange={e => { setDraftAnswer(e.target.value); setPublicReviewed(false); }} maxLength={4000} rows={5} className="field" /></label>
          <label className="field-label">公开依据（可留空）<textarea value={publicExcerpt} onChange={e => { setPublicExcerpt(e.target.value); setPublicReviewed(false); }} maxLength={4000} rows={3} className="field" placeholder="填写审核后的通用说明；没有可公开依据时留空" /></label>
          <p className="muted text-sm">此处为老师审核的公开说明，不声称是工单原文摘录。原始回复仅保留在受保护的工单内。</p>
          <label className="field-label">类别<select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSupersedes(''); setCandidates([]); setCandidatePage(1); setPublicReviewed(false); }} className="field">
            {detail.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <button type="button" className="button-secondary" onClick={() => setShowCandidates(v => !v)}>{showCandidates ? '收起替换候选' : '查看替换候选（可选）'}</button>
          {supersedes && <p className="notice">已选替换条目：{supersedes}<button onClick={() => { setSupersedes(''); setPublicReviewed(false); }}>取消替换</button></p>}
          {showCandidates && <div className="space-y-3" aria-label="替换候选">
            {candidateLoading ? <p role="status">正在加载候选…</p> : candidateError ? <p role="alert">{candidateError}<button onClick={() => setCandidateRetry(v => v + 1)}>重试候选</button></p> : <>
              {candidates.length === 0 && <p>本类别暂无已确认知识</p>}
              {candidates.map(item => <div key={item.id} className="notice text-sm"><b>{item.question}</b><p className="whitespace-pre-wrap">{item.answer}</p><button onClick={() => { setSupersedes(item.id); setPublicReviewed(false); }}>选择替换</button></div>)}
              <div className="flex gap-3"><button disabled={candidatePage <= 1} onClick={() => setCandidatePage(p => p - 1)}>上一页</button><span>第 {candidatePage} 页，共 {candidateTotal} 条</span><button disabled={candidatePage * 10 >= candidateTotal} onClick={() => setCandidatePage(p => p + 1)}>下一页</button></div>
            </>}
          </div>}
          <label className="flex gap-2"><input type="checkbox" checked={publicReviewed} onChange={e => setPublicReviewed(e.target.checked)} />我已审核将向学生公开的问题、答案及依据，确认不含个人身份信息或个人办理结果</label>
          <button type="button" disabled={busy || conflict || !binding || !publicReviewed || binding.reply !== reply || !draftQuestion.trim() || !draftAnswer.trim()} onClick={() => void confirm()} className="button-primary">确认入库</button>
        </>}
      </fieldset>
      {message && <p role="status" className="notice">{message}</p>}
      <button disabled={busy} onClick={() => void compareLatest()} className="button-secondary">{conflict ? '版本冲突：读取最新回复并对照' : '读取最新状态（保留输入）'}</button>
      {latest && <section className="panel space-y-3"><h2>最新回复与当前输入对照</h2><p>数据库版本 {latest.ticket.reply_version}</p><p className="whitespace-pre-wrap">最新回复：{latest.ticket.teacher_reply || '尚无回复'}</p><p className="whitespace-pre-wrap">当前输入：{reply}</p>
        <button disabled={busy} onClick={() => useLatest(true)}>保留当前输入，使用最新版本重新编辑</button><button disabled={busy} onClick={() => useLatest(false)}>采用最新回复</button></section>}
    </div>}
  </main></div>;
}
