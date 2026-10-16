'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { conversationError, readConversationError } from '@/lib/conversation-errors';
import type { PublicUser } from '@/lib/auth-core';
import type { AskResponse, Contact } from '@/lib/types';

const examples = ['在读证明怎么开？', '缓考怎么申请？', '宿舍报修找谁？'];
const fallbackText = '这个问题我暂时无法确定，建议联系以下老师，或提交给老师。';
type Message = { role: 'user'; text: string } | { role: 'assistant'; question: string; data?: AskResponse; error?: string; notice?: string };
type HistoryEntry = { question: string; response?: AskResponse; error?: string };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };
type UiFailure = { code: string; message: string };
const activeConversationKey = (userId: string) => `student_active_conversation:${userId}`;

function ContactCard({ contact }: { contact: Contact }) {
  return <div className="content-card text-sm">
    <div className="font-semibold">{contact.name} <span className="muted font-normal">{contact.role === 'teacher' ? '老师' : '学生负责人'}</span></div>
    {contact.phone && <div className="mt-1">电话：<a href={`tel:${contact.phone}`}>{contact.phone}</a></div>}
    {contact.email && <div>邮箱：<a href={`mailto:${contact.email}`}>{contact.email}</a></div>}
    {contact.office && <div>办公地点：{contact.office}</div>}
    {contact.office_hours && <div>办公时间：{contact.office_hours}</div>}
  </div>;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<UiFailure | null>(null);
  const [listError, setListError] = useState<UiFailure | null>(null);
  const [historyError, setHistoryError] = useState<UiFailure | null>(null);
  const [createError, setCreateError] = useState<UiFailure | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [ticketTarget, setTicketTarget] = useState<{ question: string; categoryId: string | null } | null>(null);
  const [ticketDetail, setTicketDetail] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const activeIdRef = useRef('');
  const historyController = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);
  const userIdRef = useRef('');
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw await readConversationError(response);
        const result = await response.json() as { user: PublicUser | null };
        if (controller.signal.aborted) return;
        if (!result.user) {
          setAuthError(conversationError(401, 'UNAUTHENTICATED'));
          return;
        }
        userIdRef.current = result.user.id;
        setUser(result.user);
        void loadConversations(result.user.id);
      } catch (error) {
        if (!controller.signal.aborted) setAuthError(isUiFailure(error) ? error : conversationError(0, 'NETWORK_ERROR'));
      } finally {
        if (!controller.signal.aborted) setAuthLoading(false);
      }
    })();
    return () => { controller.abort(); listController.current?.abort(); historyController.current?.abort(); };
  }, []);
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  function isUiFailure(error: unknown): error is UiFailure {
    return !!error && typeof error === 'object' && 'code' in error && 'message' in error;
  }

  function handleFailure(error: UiFailure) {
    if (error.code === 'UNAUTHENTICATED') {
      listController.current?.abort();
      historyController.current?.abort();
      userIdRef.current = '';
      activeIdRef.current = '';
      setUser(null);
      setConversations([]);
      setMessages([]);
      setActiveId('');
      setListError(null);
      setHistoryError(null);
      setCreateError(null);
      setListLoading(false);
      setHistoryLoading(false);
      setAuthError(error);
    }
    return error;
  }

  async function loadConversations(userId = userIdRef.current) {
    if (!userId) return;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListLoading(true);
    setListError(null);
    try {
      const response = await fetch('/api/conversations', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw await readConversationError(response);
      const list = (await response.json() as { conversations: Conversation[] }).conversations;
      if (controller.signal.aborted || userIdRef.current !== userId) return;
      setConversations(list);
      if (!list.length) {
        historyController.current?.abort();
        activeIdRef.current = '';
        setActiveId('');
        setMessages([]);
        setHistoryError(null);
        return;
      }
      const saved = sessionStorage.getItem(activeConversationKey(userId));
      const selected = list.find(item => item.id === saved) ?? list[0];
      if (selected.id !== activeIdRef.current) loadHistory(selected.id, userId);
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = handleFailure(isUiFailure(error) ? error : conversationError(0, 'NETWORK_ERROR'));
        if (failure.code !== 'UNAUTHENTICATED') setListError(failure);
      }
    } finally {
      if (!controller.signal.aborted) setListLoading(false);
    }
  }

  function loadHistory(id: string, userId = userIdRef.current) {
    if (sending.current || ticketLoading) return;
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    activeIdRef.current = id;
    setActiveId(id);
    sessionStorage.setItem(activeConversationKey(userId), id);
    setMessages([]);
    setInput('');
    setTicketTarget(null);
    setHistoryLoading(true);
    setHistoryError(null);
    void fetch(`/api/ask?conversation_id=${encodeURIComponent(id)}`,
      { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw await readConversationError(response);
        return response.json() as Promise<{ history: HistoryEntry[] }>;
      })
      .then(({ history }) => {
        if (controller.signal.aborted || activeIdRef.current !== id || userIdRef.current !== userId) return;
        setMessages(history.flatMap(entry => [
          { role: 'user' as const, text: entry.question },
          { role: 'assistant' as const, question: entry.question, ...(entry.response ? { data: entry.response } : { error: entry.error || '服务暂时不可用，请稍后重试' }) },
        ]));
      })
      .catch(error => {
        if (controller.signal.aborted || userIdRef.current !== userId) return;
        const failure = isUiFailure(error) ? error : conversationError(0, 'NETWORK_ERROR');
        handleFailure(failure);
        if (failure.code !== 'UNAUTHENTICATED') setHistoryError(failure);
      })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
  }

  async function newConversation() {
    if (creatingConversation || sending.current || ticketLoading || !userIdRef.current) return;
    setCreatingConversation(true);
    setCreateError(null);
    try {
      const response = await fetch('/api/conversations', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw await readConversationError(response);
      const { conversation } = await response.json() as { conversation: Conversation };
      if (!userIdRef.current) return;
      setConversations(current => [conversation, ...current]);
      loadHistory(conversation.id);
    } catch (error) {
      const failure = handleFailure(isUiFailure(error) ? error : conversationError(0, 'NETWORK_ERROR'));
      if (failure.code !== 'UNAUTHENTICATED') setCreateError(failure);
    }
    finally { setCreatingConversation(false); }
  }

  async function submit(text = input) {
    const question = text.trim();
    const conversationId = activeIdRef.current;
    if (!question || question.length > 500 || sending.current || historyLoading || !conversationId) return;
    sending.current = true;
    setLoading(true);
    setInput('');
    setMessages(current => [...current, { role: 'user', text: question }]);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversation_id: conversationId }),
        cache: 'no-store',
      });
      if (!response.ok) throw await readConversationError(response);
      const data = await response.json() as AskResponse;
      setMessages(current => [...current, { role: 'assistant', question, data }]);
      setConversations(current => {
        const selected = current.find(item => item.id === conversationId);
        if (!selected) return current;
        return [{ ...selected, title: selected.title === '新对话' ? question.slice(0, 30) : selected.title,
          updated_at: new Date().toISOString() }, ...current.filter(item => item.id !== conversationId)];
      });
    } catch (error) {
      const failure = isUiFailure(error) ? error : conversationError(0, 'NETWORK_ERROR');
      handleFailure(failure);
      if (failure.code !== 'UNAUTHENTICATED') setMessages(current => [...current, { role: 'assistant', question, error: failure.message }]);
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  async function submitTicket() {
    if (!ticketTarget || ticketLoading) return;
    const conversationId = activeIdRef.current;
    const question = ticketDetail.trim() ? `${ticketTarget.question}\n补充：${ticketDetail.trim()}` : ticketTarget.question;
    if (question.length > 500) { setTicketError('问题与补充描述合计不能超过500字'); return; }
    setTicketLoading(true);
    setTicketError('');
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ question, category_id: ticketTarget.categoryId }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || '提交失败，请稍后重试');
      }
      setTicketTarget(null);
      setTicketDetail('');
      if (activeIdRef.current === conversationId) setMessages(current => [...current, { role: 'assistant', question, notice: '工单已提交。可在“我的工单”查看老师回复。' }]);
    } catch (error) { setTicketError(error instanceof Error ? error.message : '提交失败，请稍后重试'); }
    finally { setTicketLoading(false); }
  }

  return <div className="app-shell"><SiteHeader conversationNav={{
    authenticated: !!user, loading: authLoading || listLoading, conversations, activeId,
    error: listError?.message, createError: createError?.message,
    creating: creatingConversation, disabled: loading || ticketLoading,
    onRetry: () => void loadConversations(), onCreate: () => void newConversation(), onSelect: id => loadHistory(id),
  }} /><main className="page-content home-content">
    <div className="home-grid"><div className="chat-layout">
    <section className="chat-intro"><p className="eyebrow">学生事务 · 随时可问</p><h1>把复杂的校园事务，问清楚。</h1><p>依据已审核且有效的知识库回答，附上出处与负责人。个人保存的通知须经老师整理审核后才能成为公共依据。</p>
      <nav className="quick-links" aria-label="常用功能"><Link href="/schedule">查看待办与截止事项 ↗</Link><Link href="/my">查看老师回复 ↗</Link><Link href="/add">从通知添加事项 ↗</Link></nav>
    </section>
    <section className="chat-stream" aria-live="polite" aria-label="问答记录">
      {authError && <div className="notice notice-error" role="alert">{authError.message} {authError.code === 'UNAUTHENTICATED' ? <Link href="/login?next=%2F" className="underline">重新登录</Link> : <button type="button" className="underline" onClick={() => window.location.reload()}>重试身份检查</button>}</div>}
      {!authError && authLoading && <div className="notice" role="status">正在确认身份…</div>}
      {!authLoading && user && listLoading && <div className="notice" role="status">正在加载对话列表…</div>}
      {listError && <div className="notice notice-error" role="alert">对话列表：{listError.message} <button type="button" className="underline" onClick={() => void loadConversations()}>重试列表</button></div>}
      {historyError && <div className="notice notice-error" role="alert">问答记录：{historyError.message} {historyError.code === 'NOT_FOUND' ? <button type="button" className="underline" onClick={() => void loadConversations()}>刷新列表</button> : <button type="button" className="underline" onClick={() => loadHistory(activeId)}>重试记录</button>}</div>}
      {!authLoading && user && !listLoading && !listError && !activeId && <div className="notice">还没有对话。请在左侧导航中新建对话。</div>}
      {activeId && messages.length === 0 && !historyError && <div className="notice">{historyLoading ? '正在加载问答记录…' : '这个对话还没有提问，可以从下方的常见问题开始。'}</div>}
      {activeId && messages.length === 0 && !historyLoading && !historyError && <div className="starter-topics">
        <h2>常见问题</h2>
        <div className="starter-grid">
          {[['学籍证明', examples[0]], ['考试安排', examples[1]], ['校园生活', examples[2]]].map(([category, question]) => <button key={question} type="button" disabled={loading || historyLoading || !!historyError || !activeId} onClick={() => void submit(question)}>
            <span>{category}</span><strong>{question}</strong><span className="starter-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>
      </div>}
      {messages.map((message, index) => message.role === 'user'
        ? <div key={index} className="chat-message chat-message-user">{message.text}</div>
        : <div key={index} className="chat-message chat-message-assistant space-y-4">
          <div className={message.error ? 'notice notice-error' : message.data?.answerable || message.notice ? 'notice' : 'notice notice-warning'} role={message.error ? 'alert' : 'status'}><b>{message.error ? '服务故障' : message.notice ? '提交成功' : message.data?.answerable ? '有依据的回答' : '知识不足'}</b><p className="mt-1 whitespace-pre-wrap">{message.error ?? message.notice ?? (message.data?.answerable ? message.data.answer : message.data?.notice || fallbackText)}</p></div>
          {message.data?.answerable && message.data.citations.length > 0 && <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {message.data.citations.map(citation => <div key={citation.id} className="citation-card space-y-2">
              <span className="pill">出处：{citation.source_name} · v{citation.version} · 更新于 {new Date(citation.updated_at).toLocaleDateString('zh-CN')}
                {citation.source_level === 1 && <b className="ml-2">老师确认</b>}
              </span>
              <p className="citation-summary text-sm">依据摘要：{citation.source_excerpt || citation.answer}</p>
              {citation.source_url && <a href={citation.source_url} target="_blank" rel="noreferrer" className="block text-sm underline">查看原文 ↗</a>}
              <details className="text-sm"><summary className="cursor-pointer">查看引用时的知识与依据快照</summary><p className="mt-2 whitespace-pre-wrap">{citation.question}：{citation.answer}</p>{citation.source_excerpt && <p className="mt-2 whitespace-pre-wrap">依据：{citation.source_excerpt}</p>}</details>
            </div>)}
          </div>}
          {message.data?.answerable && message.data.citations.some(citation => citation.source_url) && <Link href={`/add?url=${encodeURIComponent(message.data.citations.find(citation => citation.source_url)!.source_url!)}`} className="button-secondary">加入日程</Link>}
          {message.data && <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="font-semibold">相关负责人</div>
            {message.data.contacts.length ? message.data.contacts.map(contact => <ContactCard key={contact.id} contact={contact} />) : <div className="muted">暂无负责人信息</div>}
          </div>}
          {message.data?.category_id && <button type="button" onClick={() => { setTicketTarget({ question: message.question, categoryId: message.data!.category_id }); setTicketError(''); }} className="button-secondary">{message.data.answerable ? '仍未解决？请老师确认' : '提交工单给老师'}</button>}
          {message.error && <button type="button" disabled={loading} onClick={() => void submit(message.question)} className="button-secondary">重试提问</button>}
        </div>)}
      {loading && <div className="chat-message chat-message-assistant muted" role="status">正在查找已确认的知识…</div>}
      <div ref={bottom} />
    </section>
    <div className="chat-composer-wrap"><form className="chat-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={messages.length === 0 ? 'suggestions mobile-suggestions' : 'suggestions'}>{examples.map(example => <button key={example} type="button" disabled={loading || historyLoading || !!historyError || !activeId} onClick={() => void submit(example)}>{example}</button>)}</div>
      <div className="flex gap-2"><input aria-label="输入问题" value={input} onChange={event => setInput(event.target.value)} maxLength={500} placeholder="输入你的问题（最多 500 字）" className="field min-w-0 flex-1" />
        <button disabled={loading || historyLoading || !!historyError || !activeId || !input.trim()} className="button-primary">发送 <span aria-hidden="true">↗</span></button></div>
    </form></div>
    </div>
    <aside className="home-rail" aria-label="办事指引">
      <details className="rail-panel rail-help">
        <summary>提问建议与使用说明</summary>
        <h2>让问题更容易得到准确回答</h2>
        <ul className="rail-advice">
          <li><strong>说明具体事项</strong><span>例如证明类型、申请项目或报修位置。</span></li>
          <li><strong>补充关键条件</strong><span>如办理时间、适用对象或已看到的通知。</span></li>
          <li><strong>保护个人信息</strong><span>不要填写学号、电话或其他敏感信息。</span></li>
        </ul>
        <div className="rail-help-divider" />
        <h2>如何使用回答</h2>
        <ol className="rail-steps">
          <li><span>01</span><p>查看引用来源及更新时间。</p></li>
          <li><span>02</span><p>核对相关负责人和原通知。</p></li>
          <li><span>03</span><p>仍不确定时，将问题提交给老师。</p></li>
        </ol>
      </details>
    </aside></div>
    {ticketTarget && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ticket-title">
      <div className="modal-panel max-w-lg space-y-4">
        <h2 id="ticket-title" className="text-xl font-semibold">提交给老师</h2>
        <p className="muted text-sm">原问题：{ticketTarget.question}</p>
        <label className="field-label">补充描述（可选）
          <textarea value={ticketDetail} onChange={event => setTicketDetail(event.target.value)} maxLength={500} rows={4} className="field" />
        </label>
        <p className="notice notice-warning">请勿填写学号、电话等个人信息</p>
        {ticketError && <p role="alert" className="notice notice-error">{ticketError}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={ticketLoading} onClick={() => setTicketTarget(null)} className="button-quiet">取消</button>
          <button type="button" disabled={ticketLoading} onClick={() => void submitTicket()} className="button-primary">{ticketLoading ? '提交中…' : '确认提交'}</button></div>
      </div>
    </div>}
  </main></div>;
}
