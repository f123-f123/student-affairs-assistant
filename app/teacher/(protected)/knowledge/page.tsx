'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/app/components/SiteHeader';

type Category = { id: string; name: string };
type Item = { id: string; category_id: string; question: string; answer: string; source_name: string; source_level: number; source_url: string | null; source_excerpt: string | null; aliases: string[]; valid_from: string | null; valid_until: string | null; status: string; version: number; reviewed_at: string | null; reviewed_by: string | null; updated_at: string; categories: { name: string } | null };

export default function TeacherKnowledge() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceExcerpt, setSourceExcerpt] = useState('');
  const [aliases, setAliases] = useState('');
  const [originEventId, setOriginEventId] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [history, setHistory] = useState<{ version: number; snapshot: Item }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'draft' | 'all' | 'confirmed' | 'inactive'>('draft');

  async function load() {
    const response = await fetch('/api/teacher/knowledge', { cache: 'no-store' });
    if (!response.ok) throw new Error('知识库暂时无法加载');
    const data = await response.json() as { categories: Category[]; items: Item[] };
    setCategories(data.categories);
    setItems(data.items);
    setCategoryId(current => current || data.categories[0]?.id || '');
  }
  useEffect(() => { void load().catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch(editing ? `/api/teacher/knowledge/${editing.id}` : '/api/teacher/knowledge', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...(editing ? { action: 'edit', version: editing.version } : {}), category_id: categoryId, question, answer,
          source_name: sourceName, source_url: sourceUrl || null, source_excerpt: sourceExcerpt,
          aliases: aliases.split(/[，,\n]/).map(value => value.trim()).filter(Boolean),
          origin_event_id: originEventId || null, supersedes: supersedes || null,
          valid_from: validFrom ? new Date(validFrom).toISOString() : null,
          valid_until: validUntil ? new Date(validUntil).toISOString() : null }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      setQuestion(''); setAnswer(''); setSourceUrl(''); setSourceName(''); setSourceExcerpt(''); setAliases(''); setOriginEventId(''); setSupersedes(''); setValidFrom(''); setValidUntil(''); setEditing(null);
      await load();
      setMessage('草稿已保存，审核发布后才会进入公共问答');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function act(item: Item, action: 'publish' | 'disable') {
    setSaving(true); setMessage('');
    try {
      const response = await fetch(`/api/teacher/knowledge/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: item.version }), cache: 'no-store' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '操作失败');
      await load(); setMessage(action === 'publish' ? '已发布，下次提问立即生效' : '已停用');
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { setSaving(false); }
  }
  function fill(item: Item, replace = false) {
    setEditing(replace ? null : item); setSupersedes(replace ? item.id : ''); setCategoryId(item.category_id);
    setQuestion(item.question); setAnswer(item.answer); setSourceName(item.source_name); setSourceUrl(item.source_url || '');
    setSourceExcerpt(item.source_excerpt || ''); setAliases((item.aliases || []).join('，'));
    const localTime = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    setValidFrom(localTime(item.valid_from)); setValidUntil(localTime(item.valid_until));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function showHistory(item: Item) {
    const response = await fetch(`/api/teacher/knowledge/${item.id}`, { cache: 'no-store' });
    if (!response.ok) { setMessage('版本加载失败'); return; }
    const data = await response.json() as { history: { version: number; snapshot: Item }[] };
    setHistory(data.history); setMessage(`正在查看「${item.question}」的旧版本`);
  }

  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width space-y-6">
    <div className="page-head"><p className="eyebrow">老师工作台</p><h1 className="page-title">知识库</h1><p className="page-description">保存草稿、核对依据，再审核发布。</p></div>
    <form onSubmit={event => void save(event)} className="panel space-y-4">
      <h2 className="text-xl font-semibold">{editing ? '编辑草稿' : supersedes ? '替换草稿' : '新增草稿'}</h2>
      <label className="field-label">类别<select className="field" value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={loading || saving}>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label>
      <label className="field-label">通用问题<textarea className="field" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} rows={2} required /></label>
      <label className="field-label">确认后的答案<textarea className="field" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={4000} rows={5} required /></label>
      <label className="field-label">来源链接（可选）<input className="field" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://学校官网/通知" /></label>
      <label className="field-label">出处名称<input className="field" value={sourceName} onChange={event => setSourceName(event.target.value)} maxLength={200} required /></label>
      <label className="field-label">原文依据<textarea className="field" value={sourceExcerpt} onChange={event => setSourceExcerpt(event.target.value)} maxLength={10000} rows={4} /></label>
      <label className="field-label">别名（逗号分隔）<input className="field" value={aliases} onChange={event => setAliases(event.target.value)} /></label>
      <label className="field-label">学生事项 ID（从通知整理时填写）<input className="field" value={originEventId} onChange={event => setOriginEventId(event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">生效时间<input className="field" type="datetime-local" value={validFrom} onChange={event => setValidFrom(event.target.value)} /></label><label className="field-label">失效时间<input className="field" type="datetime-local" value={validUntil} onChange={event => setValidUntil(event.target.value)} /></label></div>
      <p className="muted text-sm">请核对办理规则，并删除姓名、学号、电话等个人信息。该条目会标记为“老师确认”。</p>
      <button type="submit" className="button-primary" disabled={loading || saving || !categoryId || !question.trim() || !answer.trim()}>{saving ? '保存中…' : '保存草稿'}</button>
      {message && <div role="status" className="notice">{message}{message === '知识库暂时无法加载' ? <button type="button" className="ml-2 underline" onClick={() => void load().then(() => setMessage('')).catch(error => setMessage(error.message))}>重试</button> : null}</div>}
    </form>
    {history.length > 0 && <section className="panel space-y-2"><h2 className="font-semibold">历史版本</h2>{history.map(row => <div key={row.version} className="notice"><b>v{row.version} · {row.snapshot.status}</b><p>{row.snapshot.question}</p><p className="whitespace-pre-wrap">{row.snapshot.answer}</p><p>出处：{row.snapshot.source_name}</p></div>)}</section>}
    <section id="knowledge-items" className="space-y-3"><h2 className="text-xl font-semibold">知识条目（{items.length}）</h2>
      <p className="muted text-sm">草稿不会进入学生问答；发布后立即参与检索。停用或替换后，旧条目不再用于新回答，历史版本仍可查看。</p>
      <div className="filter-row" role="group" aria-label="筛选知识状态">{([['draft', '待审核'], ['confirmed', '已发布'], ['inactive', '已停用或替换'], ['all', '全部']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? 'button-secondary segment-active' : 'button-secondary'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{value === 'draft' ? `（${items.filter(item => item.status === 'draft').length}）` : ''}</button>)}</div>
      {loading ? <div className="skeleton" role="status" aria-label="正在加载知识条目" /> : items.filter(item => filter === 'all' || filter === 'inactive' && item.status !== 'draft' && item.status !== 'confirmed' || item.status === filter).map(item => <article key={item.id} className="content-card space-y-2">
        <div className="flex flex-wrap gap-2 text-sm"><span className="pill">{item.categories?.name || '未分类'}</span><span className={item.status === 'draft' ? 'pill pill-warning' : 'pill'}>{item.status === 'draft' ? '待审核' : item.status === 'confirmed' ? '已发布' : '已停用或替换'} · v{item.version}</span><span className="muted">{item.source_name} · 审核：{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString('zh-CN') : '未审核'} · {item.reviewed_by || '未具名'}</span></div>
        <h3 className="font-semibold">{item.question}</h3><p className="whitespace-pre-wrap text-sm">{item.answer}</p>
        {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="text-sm underline">查看来源</a>}
        <div className="flex flex-wrap gap-2">{item.status === 'draft' && <><button type="button" className="button-secondary" onClick={() => fill(item)}>编辑</button><button type="button" className="button-primary" disabled={saving} onClick={() => void act(item, 'publish')}>审核并发布</button></>}{item.status === 'confirmed' && <><button type="button" className="button-secondary" onClick={() => fill(item, true)}>创建替换草稿</button><button type="button" className="button-secondary" disabled={saving} onClick={() => void act(item, 'disable')}>停用新回答引用</button></>}<button type="button" className="button-quiet" onClick={() => void showHistory(item)}>查看版本</button></div>
      </article>)}
      {!loading && !items.some(item => filter === 'all' || filter === 'inactive' && item.status !== 'draft' && item.status !== 'confirmed' || item.status === filter) && <div className="empty-state">当前筛选下没有知识条目。</div>}
    </section>
  </main></div>;
}
