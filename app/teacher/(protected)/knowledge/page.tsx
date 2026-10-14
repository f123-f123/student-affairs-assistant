'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/app/components/SiteHeader';

type Category = { id: string; name: string };
type Item = { id: string; category_id: string; question: string; answer: string; source_name: string; source_level: number; source_url: string | null; updated_at: string; categories: { name: string } | null };

export default function TeacherKnowledge() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

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
      const response = await fetch('/api/teacher/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ category_id: categoryId, question, answer, source_url: sourceUrl || null }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      setQuestion(''); setAnswer(''); setSourceUrl('');
      await load();
      setMessage('已加入知识库，下次提问即可引用');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }

  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width space-y-6">
    <div className="page-head"><p className="eyebrow">老师工作台</p><h1 className="page-title">知识库</h1><p className="page-description">直接录入已核实的通用问答，保存后立即供学生问答引用。</p></div>
    <form onSubmit={event => void save(event)} className="panel space-y-4">
      <h2 className="text-xl font-semibold">新增已确认条目</h2>
      <label className="field-label">类别<select className="field" value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={loading || saving}>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label>
      <label className="field-label">通用问题<textarea className="field" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} rows={2} required /></label>
      <label className="field-label">确认后的答案<textarea className="field" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={4000} rows={5} required /></label>
      <label className="field-label">来源链接（可选）<input className="field" type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://学校官网/通知" /></label>
      <p className="muted text-sm">请核对办理规则，并删除姓名、学号、电话等个人信息。该条目会标记为“老师确认”。</p>
      <button type="submit" className="button-primary" disabled={loading || saving || !categoryId || !question.trim() || !answer.trim()}>{saving ? '保存中…' : '确认入库'}</button>
      {message && <p role="status" className="notice">{message}</p>}
    </form>
    <section className="space-y-3"><h2 className="text-xl font-semibold">已确认条目（{items.length}）</h2>
      {loading ? <div className="skeleton" role="status" aria-label="正在加载知识条目" /> : items.map(item => <article key={item.id} className="content-card space-y-2">
        <div className="flex flex-wrap gap-2 text-sm"><span className="pill">{item.categories?.name || '未分类'}</span><span className="muted">{item.source_name} · {new Date(item.updated_at).toLocaleDateString('zh-CN')}</span></div>
        <h3 className="font-semibold">{item.question}</h3><p className="whitespace-pre-wrap text-sm">{item.answer}</p>
        {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="text-sm underline">查看来源</a>}
      </article>)}
    </section>
  </main></div>;
}
