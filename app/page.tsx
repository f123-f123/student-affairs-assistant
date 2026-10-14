'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import { getDeviceId } from '@/lib/device';
import type { AskResponse, Contact } from '@/lib/types';

const examples = ['在读证明怎么开？', '缓考怎么申请？', '宿舍报修找谁？'];
const fallbackText = '这个问题我暂时无法确定，建议联系以下老师，或提交给老师。';
type Message = { role: 'user'; text: string } | { role: 'assistant'; question: string; data?: AskResponse; error?: string };
type HistoryEntry = { question: string; response?: AskResponse; error?: string };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };
const activeConversationKey = 'student_active_conversation';

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
  const [conversationError, setConversationError] = useState('');
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [ticketTarget, setTicketTarget] = useState<{ question: string; categoryId: string } | null>(null);
  const [ticketDetail, setTicketDetail] = useState('');
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const deviceId = useRef<string>('');
  const activeIdRef = useRef('');
  const historyController = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    deviceId.current = getDeviceId();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/conversations?device_id=${encodeURIComponent(deviceId.current)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('对话列表加载失败');
        let list = (await response.json() as { conversations: Conversation[] }).conversations;
        if (cancelled) return;
        if (!list.length) {
          const created = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ device_id: deviceId.current }) });
          if (!created.ok) throw new Error('新建对话失败');
          list = [(await created.json() as { conversation: Conversation }).conversation];
        }
        if (cancelled) return;
        setConversations(list);
        const saved = sessionStorage.getItem(activeConversationKey);
        const selected = list.find(item => item.id === saved) ?? list[0];
        loadHistory(selected.id);
      } catch (error) {
        if (!cancelled) { setConversationError(error instanceof Error ? error.message : '对话列表加载失败'); setHistoryLoading(false); }
      }
    })();
    return () => { cancelled = true; historyController.current?.abort(); };
  }, []);
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  function loadHistory(id: string) {
    if (sending.current || ticketLoading) return;
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    activeIdRef.current = id;
    setActiveId(id);
    sessionStorage.setItem(activeConversationKey, id);
    setMessages([]);
    setInput('');
    setTicketTarget(null);
    setHistoryLoading(true);
    setConversationError('');
    void fetch(`/api/ask?device_id=${encodeURIComponent(deviceId.current)}&conversation_id=${encodeURIComponent(id)}`,
      { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ history: HistoryEntry[] }> : Promise.reject())
      .then(({ history }) => {
        if (controller.signal.aborted || activeIdRef.current !== id) return;
        setMessages(history.flatMap(entry => [
          { role: 'user' as const, text: entry.question },
          { role: 'assistant' as const, question: entry.question, ...(entry.response ? { data: entry.response } : { error: entry.error || '服务暂时不可用，请稍后重试' }) },
        ]));
      })
      .catch(() => { if (!controller.signal.aborted) setConversationError('问答记录加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
  }

  async function newConversation() {
    if (creatingConversation || sending.current || ticketLoading) return;
    setCreatingConversation(true);
    setConversationError('');
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ device_id: deviceId.current || getDeviceId() }) });
      if (!response.ok) throw new Error('新建对话失败');
      const { conversation } = await response.json() as { conversation: Conversation };
      setConversations(current => [conversation, ...current]);
      loadHistory(conversation.id);
    } catch (error) { setConversationError(error instanceof Error ? error.message : '新建对话失败'); }
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
        body: JSON.stringify({ question, device_id: deviceId.current || getDeviceId(), conversation_id: conversationId }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('service_failed');
      const data = await response.json() as AskResponse;
      setMessages(current => [...current, { role: 'assistant', question, data }]);
      setConversations(current => {
        const selected = current.find(item => item.id === conversationId);
        if (!selected) return current;
        return [{ ...selected, title: selected.title === '新对话' ? question.slice(0, 30) : selected.title,
          updated_at: new Date().toISOString() }, ...current.filter(item => item.id !== conversationId)];
      });
    } catch {
      setMessages(current => [...current, { role: 'assistant', question, error: '服务暂时不可用，请稍后重试' }]);
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
        body: JSON.stringify({ question, category_id: ticketTarget.categoryId, device_id: deviceId.current || getDeviceId() }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || '提交失败，请稍后重试');
      }
      setTicketTarget(null);
      setTicketDetail('');
      if (activeIdRef.current === conversationId) setMessages(current => [...current, { role: 'assistant', question, error: '工单已提交。可在“我的工单”查看老师回复。' }]);
    } catch (error) { setTicketError(error instanceof Error ? error.message : '提交失败，请稍后重试'); }
    finally { setTicketLoading(false); }
  }

  return <div className="app-shell"><SiteHeader /><main className="page-content home-content">
    <div className="home-grid"><div className="chat-layout">
    <section className="conversation-panel" aria-label="我的对话">
      <div className="conversation-heading"><h2>我的对话</h2><button type="button" className="button-secondary" disabled={creatingConversation || loading || ticketLoading || !deviceId.current} onClick={() => void newConversation()}>{creatingConversation ? '新建中…' : '＋ 新对话'}</button></div>
      <div className="conversation-list">{conversations.map(conversation => <button key={conversation.id} type="button" className={conversation.id === activeId ? 'conversation-tab conversation-tab-active' : 'conversation-tab'}
        aria-current={conversation.id === activeId ? 'true' : undefined} disabled={loading || ticketLoading || creatingConversation} onClick={() => { if (conversation.id !== activeId) loadHistory(conversation.id); }} title={conversation.title}>
        <span>{conversation.title}</span><small>{new Date(conversation.updated_at).toLocaleDateString('zh-CN')}</small>
      </button>)}</div>
      {conversationError && <p role="alert" className="notice notice-error mt-2">{conversationError}</p>}
    </section>
    <section className="chat-intro"><p className="eyebrow">学生事务 · 随时可问</p><h1>把复杂的校园事务，问清楚。</h1><p>依据已确认的知识库和学生保存的通知回答，附上出处与负责人。学生保存的通知未经老师核验。</p></section>
    <section className="chat-stream" aria-live="polite" aria-label="问答记录">
      {messages.length === 0 && <div className="notice">{historyLoading ? '正在加载问答记录…' : '这个对话还没有提问，可以从下方的常见问题开始。'}</div>}
      {messages.length === 0 && !historyLoading && <div className="starter-topics">
        <h2>常见问题</h2>
        <div className="starter-grid">
          {[['学籍证明', examples[0]], ['考试安排', examples[1]], ['校园生活', examples[2]]].map(([category, question]) => <button key={question} type="button" disabled={loading || historyLoading || !activeId} onClick={() => void submit(question)}>
            <span>{category}</span><strong>{question}</strong><span className="starter-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>
      </div>}
      {messages.map((message, index) => message.role === 'user'
        ? <div key={index} className="chat-message chat-message-user">{message.text}</div>
        : <div key={index} className="chat-message chat-message-assistant space-y-4">
          <p className="whitespace-pre-wrap">{message.error ?? (message.data?.answerable ? message.data.answer : fallbackText)}</p>
          {message.data?.answerable && message.data.citations.length > 0 && <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {message.data.citations.map(citation => <div key={citation.id} className="space-y-1">
              <span className="pill">出处：{citation.source_name} · 更新于 {new Date(citation.updated_at).toLocaleDateString('zh-CN')}
                {citation.source_level === 1 && <b className="ml-2">老师确认</b>}
                {citation.source_type === 'saved_notice' && <b className="ml-2">未经老师核验</b>}
              </span>
              {citation.source_url && <a href={citation.source_url} target="_blank" rel="noreferrer" className="block text-sm underline">查看原通知</a>}
              {citation.source_text && <details className="text-sm"><summary className="cursor-pointer">查看保存的通知原文</summary><p className="mt-2 whitespace-pre-wrap">{citation.source_text}</p></details>}
            </div>)}
          </div>}
          {message.data?.answerable && message.data.citations.some(citation => citation.source_url) && <Link href={`/add?url=${encodeURIComponent(message.data.citations.find(citation => citation.source_url)!.source_url!)}`} className="button-secondary">加入日程</Link>}
          {message.data && <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="font-semibold">相关负责人</div>
            {message.data.contacts.length ? message.data.contacts.map(contact => <ContactCard key={contact.id} contact={contact} />) : <div className="muted">暂无负责人信息</div>}
          </div>}
          {message.data && !message.data.answerable && <button type="button" onClick={() => { setTicketTarget({ question: message.question, categoryId: message.data!.category_id }); setTicketError(''); }} className="button-secondary">提交给老师</button>}
        </div>)}
      {loading && <div className="chat-message chat-message-assistant muted" role="status">正在查找已确认的知识…</div>}
      <div ref={bottom} />
    </section>
    <div className="chat-composer-wrap"><form className="chat-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={messages.length === 0 ? 'suggestions mobile-suggestions' : 'suggestions'}>{examples.map(example => <button key={example} type="button" disabled={loading || historyLoading || !activeId} onClick={() => void submit(example)}>{example}</button>)}</div>
      <div className="flex gap-2"><input aria-label="输入问题" value={input} onChange={event => setInput(event.target.value)} maxLength={500} placeholder="输入你的问题（最多 500 字）" className="field min-w-0 flex-1" />
        <button disabled={loading || historyLoading || !activeId || !input.trim()} className="button-primary">发送 <span aria-hidden="true">↗</span></button></div>
    </form></div>
    </div>
    <aside className="home-rail" aria-label="办事指引">
      <section className="rail-panel">
        <p className="eyebrow">提问建议</p>
        <h2>让问题更容易得到准确回答</h2>
        <ul className="rail-advice">
          <li><strong>说明具体事项</strong><span>例如证明类型、申请项目或报修位置。</span></li>
          <li><strong>补充关键条件</strong><span>如办理时间、适用对象或已看到的通知。</span></li>
          <li><strong>保护个人信息</strong><span>不要填写学号、电话或其他敏感信息。</span></li>
        </ul>
      </section>
      <section className="rail-panel">
        <p className="eyebrow">结果说明</p>
        <h2>如何使用回答</h2>
        <ol className="rail-steps">
          <li><span>01</span><p>查看引用来源及更新时间。</p></li>
          <li><span>02</span><p>核对相关负责人和原通知。</p></li>
          <li><span>03</span><p>仍不确定时，将问题提交给老师。</p></li>
        </ol>
      </section>
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
