'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EventEditor from '@/app/components/EventEditor';
import SiteHeader from '@/app/components/SiteHeader';
import NoticeCoverage from '@/app/components/NoticeCoverage';
import DateInput from '@/app/components/DateInput';
import { displayDate } from '@/lib/date-only';
import { reparseDraftDates } from '@/lib/event-date';
import type { EventDraft, NoticeAttachment } from '@/lib/types';

type SourceInfo = { published_date: string | null; publish_date_source: string; fetched_at: string | null; completeness?: string; attachments?: NoticeAttachment[] };

export default function AddEvent() {
  const router = useRouter();
  const [mode, setMode] = useState<'url' | 'text'>('text');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [publishDate, setPublishDate] = useState('');
  const [dateEdited, setDateEdited] = useState(false);
  const [publishDateValid, setPublishDateValid] = useState(true);
  const [draftDateValid, setDraftDateValid] = useState(true);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [sourceArticleId, setSourceArticleId] = useState<string | null>(null);
  const [articlePublishDate, setArticlePublishDate] = useState('');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileView, setMobileView] = useState<'source' | 'draft'>('draft');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('url');
    if (linked) { setMode('url'); setUrl(linked); }
    const articleId = params.get('article_id');
    if (articleId) void fetch(`/api/sources/articles/${encodeURIComponent(articleId)}`, { cache: 'no-store' }).then(response => response.json()).then((result: { article?: { id: string; source_text: string; published_date: string | null; fetched_at: string; completeness: string; attachments: NoticeAttachment[] } }) => {
      if (result.article) { setMode('text'); setText(result.article.source_text); setPublishDate(result.article.published_date || ''); setArticlePublishDate(result.article.published_date || ''); setSourceArticleId(result.article.id); setSourceInfo({ published_date: result.article.published_date, publish_date_source: result.article.published_date ? 'page' : 'unknown', fetched_at: result.article.fetched_at, completeness: result.article.completeness, attachments: result.article.attachments }); }
    }).catch(() => setError('文章加载失败，请返回信息源重试'));
  }, []);
  async function extract() {
    if (loading || !publishDateValid) return;
    setDraftDateValid(true);
    setLoading(true); setError(''); setDraft(null); setSourceInfo(null); setConfirmed(false);
    try {
      const response = await fetch('/api/events/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(sourceArticleId ? { article_id: sourceArticleId, publish_date: publishDate !== articlePublishDate && dateEdited ? publishDate : undefined } : mode === 'url' ? { url, publish_date: dateEdited ? publishDate : undefined } : { text, publish_date: dateEdited ? publishDate : undefined }),
      });
      const result = await response.json() as { draft?: EventDraft; source?: typeof sourceInfo; error?: string; code?: string };
      if (result.source) setSourceInfo(result.source);
      if (!response.ok || !result.draft) throw new Error(`${result.code ? `[${result.code}] ` : ''}${result.error || '提取失败'}`);
      setDraft(result.draft);
      setPublishDate(result.draft.publish_date || '');
      if (sourceArticleId) setText(result.draft.source_text);
      setMobileView('draft');
    } catch (err) { setError(err instanceof Error ? err.message : '提取失败'); }
    finally { setLoading(false); }
  }
  async function save() {
    if (!draft || !confirmed || loading || !draftDateValid || !publishDateValid) return;
    if (draft.title === '请补充事项标题') { setError('请先根据原通知补充事项标题'); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ event: draft, source_article_id: sourceArticleId || undefined, source_fetched_at: sourceInfo?.fetched_at,
          publish_date_source: draft.date_context?.basis || sourceInfo?.publish_date_source, deadline_confirmed: !!draft.deadline && confirmed, no_deadline_confirmed: !draft.deadline && confirmed }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败');
      router.push('/schedule?saved=1');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setLoading(false); }
  }
  return <div className="app-shell"><SiteHeader /><main className="page-content reading-width space-y-6">
    <div className="page-head"><p className="eyebrow">我的日程 / 新事项</p><h1 className="page-title">添加事项</h1><p className="page-description">粘贴通知或输入官网链接，提取后对照原文确认，再加入个人日程。通知不会自动成为公共问答依据。</p></div>
    <div className="panel space-y-5">
      <div className="flex gap-2" role="group" aria-label="通知来源"><button type="button" onClick={() => setMode('text')} aria-pressed={mode === 'text'} className={mode === 'text' ? 'button-secondary segment-active' : 'button-secondary'}>粘贴通知</button><button type="button" onClick={() => setMode('url')} aria-pressed={mode === 'url'} className={mode === 'url' ? 'button-secondary segment-active' : 'button-secondary'}>官网链接</button></div>
      {mode === 'url' ? <label className="field-label">通知网址<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://学校官网/通知" className="field" /></label>
        : <label className="field-label">通知正文<textarea value={text} onChange={e => setText(e.target.value)} readOnly={!!sourceArticleId} maxLength={20000} rows={9} placeholder="在这里粘贴通知全文" className="field" /></label>}
      {sourceArticleId && <p className="notice">正在使用已保存文章快照。<button type="button" className="underline" onClick={() => { setSourceArticleId(null); setSourceInfo(null); }}>改用粘贴文本</button></p>}
      <DateInput label="发布日期（依据原文填写，未知可留空）" value={publishDate || null} onChange={value => {
        setPublishDate(value || ''); setDateEdited(true); setConfirmed(false);
        if (draft) setDraft(reparseDraftDates(draft, { publish_date: value }));
      }} onValidityChange={valid => { setPublishDateValid(valid); if (!valid) setConfirmed(false); }} />
      <button type="button" disabled={loading || !publishDateValid || (mode === 'url' ? !url.trim() : !text.trim())} onClick={() => void extract()} className={draft ? 'button-secondary' : 'button-primary'}>{loading ? '处理中…' : draft ? '重新提取' : '提取事项'}</button>
    </div>
    {sourceInfo && sourceInfo.completeness !== 'manual_text' && <NoticeCoverage attachments={sourceInfo.attachments} legacy={sourceInfo.completeness !== 'body_only'} />}
    {draft && <>
      {sourceInfo && <p className="notice">发布时间：{displayDate(draft.publish_date)}（{draft.date_context?.basis === 'signature' ? '正文落款，待核对' : draft.date_context?.basis === 'page' ? '网页提供' : draft.date_context?.basis === 'user' ? '用户选择或填写' : '未知或存在冲突'}）；获取时间：{sourceInfo.fetched_at || '手动粘贴'}。年份只根据有依据的日期补全，不使用电脑当前年份。</p>}
      <div className="flex gap-2 md:hidden" role="group" aria-label="核对视图"><button type="button" className={mobileView === 'source' ? 'button-secondary segment-active' : 'button-secondary'} aria-pressed={mobileView === 'source'} onClick={() => setMobileView('source')}>通知原文</button><button type="button" className={mobileView === 'draft' ? 'button-secondary segment-active' : 'button-secondary'} aria-pressed={mobileView === 'draft'} onClick={() => setMobileView('draft')}>整理草稿</button></div>
      <div className="compare-layout"><section className={`panel source-panel ${mobileView === 'draft' ? 'mobile-hidden' : ''}`} aria-label="通知原文"><h2 className="font-semibold">通知原文</h2><p className="muted mt-1 text-sm">请逐项核对标题、材料和截止时间。</p>{draft.source_url && <a href={draft.source_url} target="_blank" rel="noreferrer" className="mt-3 block break-all">打开原通知 ↗</a>}<p className="mt-4 whitespace-pre-wrap text-sm">{draft.source_text}</p></section>
        <section className={mobileView === 'source' ? 'mobile-hidden' : ''} aria-label="整理草稿"><EventEditor value={draft} onChange={next => { if (next.publish_date !== draft.publish_date) { setPublishDate(next.publish_date || ''); setDateEdited(true); } setDraft(next); }} confirmed={confirmed} onConfirm={setConfirmed} onDateValidityChange={setDraftDateValid} /></section></div>
      <div className={mobileView === 'source' ? 'mobile-hidden' : ''}><button type="button" disabled={loading || !confirmed || !draftDateValid || !publishDateValid || draft.title === '请补充事项标题'} onClick={() => void save()} className="button-primary">加入我的日程</button></div></>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
  </main></div>;
}
