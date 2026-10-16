'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SiteHeader from '@/app/components/SiteHeader';

type Source = { id: string; name: string; url: string; kind: 'article' | 'column'; last_checked_at: string | null };
type Article = { id: string; source_id: string; url: string; title: string; published_date: string | null; fetched_at: string; revision: number; completeness: string; source_text: string };
type LinkItem = { id: string; source_id: string; url: string; title: string };
type CheckResult = { url: string; title?: string; status: string; error?: string };

function changeExcerpt(oldText: string, newText: string) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length, newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) { oldEnd--; newEnd--; }
  return { old: oldText.slice(start, Math.min(oldEnd, start + 200)) || '（删除）', next: newText.slice(start, Math.min(newEnd, start + 200)) || '（删除）' };
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [form, setForm] = useState({ name: '', url: '', kind: 'article' as Source['kind'] });
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult[]>>({});
  const [preview, setPreview] = useState<{ article: Article; previous: { revision: number; source_text: string; fetched_at: string } | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    const response = await fetch('/api/sources', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '信息源加载失败');
    setSources(data.sources || []); setArticles(data.articles || []); setLinks(data.links || []);
  }
  useEffect(() => { void load().catch(cause => setError(cause.message)).finally(() => setLoading(false)); }, []);

  async function send(url: string, method: string, body?: object) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');
    return data;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy('save'); setError(''); setNotice('');
    try {
      await send(editing ? `/api/sources/${editing}` : '/api/sources', editing ? 'PATCH' : 'POST', form);
      setForm({ name: '', url: '', kind: 'article' }); setEditing(null);
      await load(); setNotice('信息源已保存');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    if (!window.confirm('删除此信息源及其文章快照？已保存的个人事项不会删除。')) return;
    setBusy(id); setError('');
    try { await send(`/api/sources/${id}`, 'DELETE'); await load(); setNotice('信息源已删除'); if (preview?.article.source_id === id) setPreview(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); }
    finally { setBusy(null); }
  }
  async function check(id: string) {
    setBusy(id); setError(''); setNotice('');
    try { const data = await send(`/api/sources/${id}/check`, 'POST'); setResults(old => ({ ...old, [id]: data.results })); await load(); setNotice('检查完成，结果列在信息源下方'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '检查失败'); }
    finally { setBusy(null); }
  }
  async function fetchSelected(id: string) {
    setBusy(id); setError(''); setNotice('');
    try { const data = await send(`/api/sources/${id}/articles`, 'POST', { urls: selected }); setResults(old => ({ ...old, [id]: data.results })); setSelected([]); await load(); setNotice('文章获取完成，请逐项查看结果'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '获取失败'); }
    finally { setBusy(null); }
  }
  async function openArticle(id: string) {
    setBusy(id); setError('');
    try { const response = await fetch(`/api/sources/articles/${id}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '文章加载失败'); setPreview(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '文章加载失败'); }
    finally { setBusy(null); }
  }
  const format = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未检查';
  const status = (value: string) => ({ new: '新增', updated: '更新', unchanged: '未变', known: '已发现', failed: '失败' })[value as 'new'] || value;

  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width space-y-6">
    <div className="page-head"><p className="eyebrow">个人资料</p><h1 className="page-title">我的常用信息源</h1><p className="page-description">手动检查公开文章或通知栏目。文章仅供你核对、整理个人日程，不进入公共知识库。</p></div>
    <form onSubmit={event => void save(event)} className="panel space-y-4"><h2 className="text-lg font-semibold">{editing ? '修改信息源' : `添加信息源（${sources.length}/5）`}</h2>
      <label className="field-label">名称<input className="field" value={form.name} maxLength={100} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>
      <label className="field-label">公开网址<input className="field" type="url" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} required /></label>
      <label className="field-label">类型<select className="field" value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as Source['kind'] })}><option value="article">单篇文章</option><option value="column">通知栏目</option></select></label>
      <div className="flex gap-2"><button className="button-primary" disabled={!!busy || (!editing && sources.length >= 5)}>保存</button>{editing && <button type="button" className="button-secondary" onClick={() => { setEditing(null); setForm({ name: '', url: '', kind: 'article' }); }}>取消修改</button>}</div>
      <p className="muted text-sm">仅支持管理员允许域名内的公开静态 HTML。PDF、登录页和动态页面暂不支持；收藏不会放宽域名限制。</p>
    </form>
    {error && <p role="alert" className="notice notice-error">{error} <button type="button" className="underline" onClick={() => { setError(''); void load().catch(cause => setError(cause.message)); }}>重试加载</button></p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {loading ? <p role="status" className="notice">正在加载信息源…</p> : !sources.length ? <p className="notice">还没有保存信息源。添加一篇公开通知或通知栏目后，可手动检查更新。</p> : sources.map(source => <section key={source.id} className="content-card space-y-4" aria-label={source.name}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{source.name}</h2><p className="muted text-sm">{source.kind === 'article' ? '单篇文章' : '通知栏目'} · 上次获取：{format(source.last_checked_at)}</p><a href={source.url} target="_blank" rel="noreferrer" className="break-all text-sm">{source.url}</a></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="button-primary" disabled={!!busy} onClick={() => void check(source.id)}>{busy === source.id ? '检查中…' : '检查更新'}</button><button type="button" className="button-secondary" onClick={() => { setEditing(source.id); setForm({ name: source.name, url: source.url, kind: source.kind }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>修改</button><button type="button" className="button-quiet" disabled={!!busy} onClick={() => void remove(source.id)}>删除</button></div></div>
      {results[source.id] && <div className="notice" role="status"><strong>本次结果</strong><ul className="mt-2 space-y-1">{results[source.id].map(result => <li key={result.url}>{status(result.status)}：{result.title || result.url}{result.error ? ` — ${result.error}` : ''}</li>)}</ul></div>}
      {source.kind === 'column' && <div><h3 className="font-semibold">栏目文章列表</h3><p className="muted text-sm">先检查栏目，再选择最多 5 篇获取正文。</p>{links.filter(link => link.source_id === source.id).slice(0, 10).map(link => <label key={link.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={selected.includes(link.url)} onChange={event => setSelected(old => event.target.checked ? [...old, link.url].slice(0, 5) : old.filter(url => url !== link.url))} /><span>{link.title}</span></label>)}<button type="button" className="button-secondary mt-2" disabled={!!busy || !selected.length} onClick={() => void fetchSelected(source.id)}>获取选中文章（{selected.length}）</button></div>}
      <div><h3 className="font-semibold">已保存文章</h3>{articles.filter(article => article.source_id === source.id).length ? <ul className="mt-2 space-y-2">{articles.filter(article => article.source_id === source.id).map(article => <li key={article.id} className="rounded-lg border p-3"><strong>{article.title}</strong><p className="muted text-sm">发布：{article.published_date || '未知'} · 获取：{format(article.fetched_at)} · 版本 {article.revision} · 原文完整</p><button type="button" className="button-secondary mt-2" onClick={() => void openArticle(article.id)}>预览原文</button><Link href={`/add?article_id=${article.id}`} className="button-primary ml-2">整理事项</Link></li>)}</ul> : <p className="muted text-sm">尚无文章快照。</p>}</div>
    </section>)}
    {preview && <section className="panel space-y-3" aria-label="文章原文预览"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{preview.article.title}</h2><p className="muted text-sm">发布时间：{preview.article.published_date || '未知'} · 获取时间：{format(preview.article.fetched_at)} · 完整性：{preview.article.completeness === 'complete' ? '完整' : '待核对'}</p></div><button type="button" className="button-secondary" onClick={() => setPreview(null)}>关闭</button></div>
      <a href={preview.article.url} target="_blank" rel="noreferrer" className="break-all text-sm">打开来源 ↗</a>
      {preview.previous && <div className="notice notice-warning"><strong>与上一版不同的片段（最多展示 200 字）</strong><p className="mt-2">上一版：{changeExcerpt(preview.previous.source_text, preview.article.source_text).old}</p><p className="mt-1">当前版：{changeExcerpt(preview.previous.source_text, preview.article.source_text).next}</p></div>}
      <div className={preview.previous ? 'compare-layout' : ''}><div><h3 className="font-semibold">当前原文</h3><p className="notice mt-2 whitespace-pre-wrap">{preview.article.source_text}</p></div>{preview.previous && <div><h3 className="font-semibold">上一版原文（版本 {preview.previous.revision}）</h3><p className="notice mt-2 whitespace-pre-wrap">{preview.previous.source_text}</p></div>}</div>
      <p className="muted text-sm">原文更新不会覆盖已确认的个人事项，请对照差异后自行决定是否重新整理。</p>
    </section>}
  </main></div>;
}
