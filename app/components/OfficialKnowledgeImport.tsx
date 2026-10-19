'use client';

import { useEffect, useRef, useState } from 'react';
import type { ImportBatch, ImportData, ImportDraft, KnowledgeScope } from '@/lib/knowledge-import';
import type { KnowledgeItem } from '@/lib/types';
import { displayDate } from '@/lib/date-only';
import ImportNoticeContacts from './ImportNoticeContacts';

type ReviewDraft = ImportDraft & { validation: { errors: string[]; warnings: string[]; date_note?: string | null }; duplicates: (KnowledgeItem & { different_scope: boolean; same_source: boolean })[] };
type State = { batch: ImportBatch; drafts: ReviewDraft[]; categories: { id: string; name: string }[] };
type BatchLink = { id: string; title: string; requested_url: string; status: string };
const labels = { fetching: '正在抓取', generating: '正在整理', saving: '保存草稿中', publishing: '发布中' };
const needsDateReview = (draft: ReviewDraft) => draft.validation.warnings.some(w => w.includes('须老师确认'));
function publishProblems(draft: ReviewDraft) {
  return [...new Set([...draft.validation.errors,
    ...(!draft.data.scope_confirmed || !draft.data.semantics_confirmed ? ['请勾选下方审核确认，核对适用范围及答案的原文依据'] : []),
    ...(!draft.data.date_confirmed && needsDateReview(draft) ? ['请核对补全日期并勾选审核确认'] : []),
    ...(draft.data.issues.some(issue => issue.trim()) ? ['请先处理并清空「待人工处理问题」'] : [])])];
}
export default function OfficialKnowledgeImport() {
  const [url, setUrl] = useState(''), [state, setState] = useState<State | null>(null), [batches, setBatches] = useState<BatchLink[]>([]);
  const [busy, setBusy] = useState<keyof typeof labels | ''>(''), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const [dirty, setDirty] = useState(false), [view, setView] = useState<'source' | 'drafts'>('drafts');
  const [highlight, setHighlight] = useState(''); const sourceMark = useRef<HTMLElement>(null), publicationKey = useRef('');
  const [focusedId, setFocusedId] = useState('');
  const restoreSequence = useRef(0);
  async function request(path: string, method = 'GET', data?: object) {
    const response = await fetch(`/api/teacher/imports${path}`, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    let result;
    try { result = await response.json(); } catch { throw new Error('导入服务响应异常，请重试当前步骤；已编辑的草稿仍保留'); }
    if (!response.ok) {
      const details = Array.isArray(result.details) ? result.details.flatMap((item: { reasons?: unknown }) => Array.isArray(item?.reasons) ? item.reasons.filter((reason: unknown) => typeof reason === 'string') : []) : typeof result.details === 'string' ? [result.details] : [];
      throw Object.assign(new Error([result.error || '操作失败', ...new Set(details)].join('；')), { details: result.details });
    }
    return result;
  }
  const list = async () => setBatches((await request('')).batches);
  async function restore(id: string, preserveFocus = false) {
    const sequence = ++restoreSequence.current;
    const data = await request(`/${id}`) as State;
    if (sequence !== restoreSequence.current) return;
    setState(data); setUrl(data.batch.requested_url); setDirty(false); setHighlight('');
    const active = data.drafts.filter(d => d.status === 'draft');
    setFocusedId(current => preserveFocus && data.drafts.some(d => d.id === current) ? current : active[0]?.id || data.drafts[0]?.id || '');
    window.history.replaceState(null, '', `?batch=${id}`);
  }
  useEffect(() => {
    void list().catch(error => { setMessage(error.message); setFailed(true); });
    const id = new URLSearchParams(window.location.search).get('batch');
    if (id) void restore(id).catch(error => { setMessage(error.message); setFailed(true); });
  }, []);
  useEffect(() => { if (highlight) sourceMark.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [highlight, view]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  function update(id: string, patch: Partial<ImportData>, confirmation = false) {
    setState(current => current && ({ ...current, drafts: current.drafts.map(d => d.id !== id ? d : { ...d, data: { ...d.data,
      ...(!confirmation ? { scope_confirmed: false, semantics_confirmed: false, date_confirmed: false } : {}), ...patch } }) }));
    setDirty(true); publicationKey.current = '';
  }
  async function perform(stage: keyof typeof labels, work: () => Promise<void>) {
    if (busy) return; setBusy(stage); setFailed(false); setMessage('');
    try { await work(); } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : '操作失败，已编辑的草稿仍保留');
      const details = (error as { details?: { id: string; reasons: string[] }[] })?.details;
      if (Array.isArray(details)) setState(current => current && ({ ...current, drafts: current.drafts.map(draft => {
        const conflict = details.find(item => item.id === draft.id);
        return conflict ? { ...draft, validation: { ...draft.validation, errors: conflict.reasons } } : draft;
      }) }));
    }
    finally { setBusy(''); }
  }
  async function capture() {
    if (dirty) { setMessage('请先保存当前已编辑的草稿，再抓取其他原文'); return; }
    await perform('fetching', async () => {
      const result = await request('', 'POST', { url }); await restore(result.id); await list();
      setMessage(result.existing ? '相同内容已有批次，已恢复审核进度；没有重复生成草稿。' : '原文已保存，尚未进入学生问答。请开始整理草稿。');
    });
  }
  async function generate() {
    if (!state) return;
    await perform('generating', async () => {
      const result = await request(`/${state.batch.id}/generate`, 'POST', { version: state.batch.version });
      await restore(state.batch.id); await list(); setMessage(result.message || '一版综合草稿已整理，请核对原文并勾选审核确认；尚未发布。');
    });
  }
  async function save() {
    if (!state) return;
    const drafts = state.drafts.filter(d => d.status !== 'published').map(({ id, version, status, data }) => ({ id, version, status, data }));
    if (!drafts.length) return;
    await perform('saving', async () => {
      await request(`/${state.batch.id}`, 'PATCH', { version: state.batch.version, drafts });
      await restore(state.batch.id, true); await list(); setMessage('草稿已保存，刷新可继续审核；仍未进入学生问答。');
    });
  }
  async function publish() {
    if (!state || dirty || !chosen.length || blockers.length) return;
    const drafts = chosen.map(({ id, version }) => ({ id, version }));
    await perform('publishing', async () => {
      publicationKey.current ||= crypto.randomUUID();
      const data = await request(`/${state.batch.id}/publish`, 'POST', { request_id: publicationKey.current, drafts });
      await restore(state.batch.id); await list(); setMessage(`已审核发布 ${data.result.count} 条，学生下一次提问即可检索。实际ID：${data.result.ids.join('、')}`);
    });
  }
  function keepOnly(draft: ReviewDraft) {
    setState(current => current && ({ ...current, drafts: current.drafts.map(d => d.status !== 'published' ? { ...d, status: d.id === draft.id ? 'draft' : 'ignored' } : d) }));
    setFocusedId(draft.id); setDirty(true); publicationKey.current = '';
    setMessage('仅保留当前草稿待审核，其余草稿标记为已忽略，原有编辑内容保留。请保存后审核发布。');
  }
  const focused = state?.drafts.find(d => d.id === focusedId);
  const chosen = focused?.status === 'draft' ? [focused] : [];
  const blockers = chosen.flatMap(publishProblems);
  const source = state?.batch.source_text || '', position = highlight ? source.indexOf(highlight) : -1;
  return <div className="space-y-5">
    <form onSubmit={event => { event.preventDefault(); void capture(); }} className="panel space-y-3"><h2>从官网导入</h2>
      <p className="muted text-sm">单篇正文 → 一版综合草稿 → 老师审核发布。保留学院、年级、年度和项目范围，抓取不会创建个人事项。</p>
      <label className="field-label">官网文章链接<input className="field" type="url" value={url} onChange={event => setUrl(event.target.value)} maxLength={2000} required /></label>
      <button type="submit" className="button-primary" disabled={!!busy || !url.trim()}>{busy === 'fetching' ? labels.fetching : failed && !state ? '重试抓取' : '获取原文'}</button>
      <label className="field-label">继续已有导入批次<select className="field" value={state?.batch.id || ''} disabled={!!busy} onChange={event => {
        if (!event.target.value) return;
        if (dirty) { setMessage('请先保存已编辑草稿，再切换批次'); return; }
        void restore(event.target.value).catch(error => { setFailed(true); setMessage(error.message); });
      }}><option value="">选择批次</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.title || batch.requested_url} · {batch.status}</option>)}</select></label>
    </form>
    <p role="status" className={failed ? 'notice notice-error' : 'notice'}>{busy ? labels[busy] : failed ? `失败：${message}。已有原文和编辑内容保留，可重试当前步骤。` : message || (state?.drafts.length ? '待审核' : '等待导入官网文章')}</p>
    {state && <>
      <div className="import-mobile-tabs filter-row" role="group" aria-label="原文与草稿视图"><button type="button" className="button-secondary" aria-pressed={view === 'source'} onClick={() => setView('source')}>原文资料</button><button type="button" className="button-secondary" aria-pressed={view === 'drafts'} onClick={() => setView('drafts')}>问答草稿</button></div>
      <div className="official-import-grid">
        <section className={`panel space-y-4 import-source ${view === 'source' ? 'import-active' : ''}`} aria-label="导入原文"><h2 className="text-xl font-semibold">{state.batch.title || '抓取未完成'}</h2>
          <a className="break-all" href={state.batch.source_url || state.batch.requested_url} target="_blank" rel="noreferrer">{state.batch.source_url || state.batch.requested_url}</a>
          <p>发布日期：{displayDate(state.batch.published_date)}；获取：{state.batch.fetched_at || '未成功获取'}</p>
          {state.batch.date_candidates.map((candidate, i) => <p className="notice text-sm" key={i}>{candidate.kind === 'signature' ? '正文落款' : '网页元数据'}：{displayDate(candidate.date)}<br />{candidate.evidence}</p>)}
          {new Set(state.batch.date_candidates.map(d => d.date)).size > 1 && <p className="notice notice-warning">发布日期存在冲突，日期草稿须选择有依据的日期并核对。</p>}
          <p className="muted text-sm">发布日期仅用于识别通知日期，不表示规则生效日。仅抓取网页正文，未核验整份资料完整性。</p>
          <h3>附件清单</h3>{state.batch.attachments.length ? state.batch.attachments.map((attachment, i) => <p key={i}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a> · 未解析（{attachment.format}）</p>) : <p className="muted">未发现附件链接；不能据此认定资料完整。</p>}
          <h3>正文快照</h3><p className="notice whitespace-pre-wrap break-words">{position >= 0 ? <>{source.slice(0, position)}<mark ref={sourceMark}>{highlight}</mark>{source.slice(position + highlight.length)}</> : source || state.batch.error_message}</p>
          {state.batch.error_message && <p role="alert" className="notice notice-error">{state.batch.error_message}</p>}
        </section>
        <section className={`space-y-4 import-drafts ${view === 'drafts' ? 'import-active' : ''}`} aria-label="问答草稿">
          <ImportNoticeContacts key={state.batch.id} batchId={state.batch.id} categoryId={focused?.data.category_id || state.categories[0]?.id || ''} knowledgeStatus={state.drafts.some(d => d.status === 'published') ? '已发布知识可用，其他草稿仍待审核' : '尚未发布'} disabled={!!busy} onLocate={excerpt => { setHighlight(excerpt); setView('source'); }} />
          <div className="panel space-y-3"><h2>综合问答草稿</h2><p className="muted text-sm">每篇新通知只整理一版。核对内容 → 勾选审核确认 → 保存草稿与校验 → 发布。校验通过后仍需老师确认。</p>
            {state.drafts.length > 1 && <><label className="field-label">查看已有草稿（一次只显示一条）<select className="field" value={focusedId} disabled={!!busy} onChange={event => { setFocusedId(event.target.value); publicationKey.current = ''; }}>{state.drafts.map((d, i) => <option value={d.id} key={d.id}>草稿 {i + 1} · {d.status === 'ignored' ? '已忽略' : d.status === 'published' ? '已发布' : '待审核'} · {d.data.question}</option>)}</select></label>
              {focused && focused.status !== 'published' && <button type="button" className="button-secondary" disabled={!!busy} onClick={() => keepOnly(focused)}>仅保留当前草稿待审核</button>}<p className="muted text-sm">旧批次其余草稿可以忽略，内容仍可在列表中查看、恢复。</p></>}
            <div className="flex flex-wrap gap-2"><button type="button" className="button-secondary" disabled={!!busy || !!state.drafts.length || !source} onClick={() => void generate()}>{failed ? '重试整理一版' : '整理一版综合问答'}</button>
              <button type="button" className="button-secondary" disabled={!!busy || !dirty} onClick={() => void save()}>保存草稿与校验</button>
              <button type="button" className="button-primary" disabled={!!busy || dirty || !chosen.length || !!blockers.length} onClick={() => void publish()}>审核并发布所选草稿</button></div>
            {dirty && <p className="notice notice-warning">有未保存编辑，请先保存并查看最新校验结果，再发布。</p>}
            {!dirty && blockers.length > 0 && <div className="notice notice-warning"><b>发布前还需完成：</b>{[...new Set(blockers)].map(reason => <p key={reason}>{reason}</p>)}</div>}
          </div>
          {state.drafts.filter(d => d.id === focusedId).map(draft => <article key={draft.id} className="panel space-y-3"><div className="flex justify-between"><span>当前草稿 · v{draft.version}</span><span>{draft.status === 'published' ? '已发布' : draft.status === 'ignored' ? '已忽略' : '待审核'}</span></div>
            <fieldset disabled={!!busy || draft.status === 'published'} className="space-y-3">
              <label className="field-label">类别<select className="field" value={draft.data.category_id} onChange={event => update(draft.id, { category_id: event.target.value, supersedes: null, replacement_version: null })}>{state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="field-label">问题<textarea className="field" rows={2} maxLength={500} value={draft.data.question} onChange={event => update(draft.id, { question: event.target.value })} /></label>
              <label className="field-label">答案<textarea className="field" rows={5} maxLength={4000} value={draft.data.answer} onChange={event => update(draft.id, { answer: event.target.value })} /></label>
              <label className="field-label">别名（分号分隔）<input className="field" value={draft.data.aliases.join('；')} onChange={event => update(draft.id, { aliases: event.target.value.split(/[;；]/) })} /></label>
              {([['units', '学园/学院'], ['cohorts', '年级'], ['years', '年度/学年'], ['projects', '项目'], ['conditions', '必要条件']] as const).map(([key, label]) => <label key={key} className="field-label">适用范围 · {label}（分号分隔）<input className="field" value={draft.data.scope[key].join('；')} onChange={event => update(draft.id, { scope: { ...draft.data.scope, [key]: event.target.value.split(/[;；]/) } as KnowledgeScope })} /></label>)}
              <label className="field-label">原文依据（多段用单独一行 --- 分隔）<textarea className="field" rows={5} value={draft.data.excerpts.join('\n---\n')} onChange={event => update(draft.id, { excerpts: event.target.value.split('\n---\n') })} /></label>
              {draft.data.excerpts.map((excerpt, i) => <button className="button-quiet text-left" key={i} type="button" onClick={() => { setHighlight(excerpt); setView('source'); }}>定位依据 {i + 1} ↗</button>)}
              <label className="field-label">补全年份的日期依据<select className="field" value={draft.data.publication_date || ''} onChange={event => update(draft.id, { publication_date: event.target.value || null })}><option value="">未选择；仅使用无冲突候选</option>{state.batch.date_candidates.map((d, i) => <option key={i} value={d.date}>{displayDate(d.date)} · {d.kind === 'signature' ? '落款' : '网页'}</option>)}</select></label>
              <label className="flex gap-2"><input type="checkbox" checked={draft.data.attachment_dependency} onChange={event => update(draft.id, { attachment_dependency: event.target.checked })} />答案仍依赖未解析附件（阻止发布）</label>
              <label className="field-label">待人工处理问题<textarea className="field" rows={2} value={draft.data.issues.join('\n')} onChange={event => update(draft.id, { issues: event.target.value.split('\n') })} /></label>
              <label className="notice flex gap-2"><input type="checkbox" checked={draft.data.scope_confirmed && draft.data.semantics_confirmed && (!needsDateReview(draft) || draft.data.date_confirmed)} onChange={event => update(draft.id, { scope_confirmed: event.target.checked, semantics_confirmed: event.target.checked, date_confirmed: event.target.checked }, true)} />我已核对适用范围、答案的原文依据及日期，并处理待人工问题；确认后保存草稿再发布</label>
              <h3>相近已有条目</h3><label className="field-label">发布处理方式<select className="field" value={draft.data.supersedes || ''} onChange={event => {
                const item = draft.duplicates.find(d => d.id === event.target.value); update(draft.id, { supersedes: item?.id || null, replacement_version: item?.version || null });
              }}><option value="">保留为独立知识</option>{draft.duplicates.filter(d => d.status === 'confirmed' && !d.different_scope).map(item => <option key={item.id} value={item.id}>明确替换：{item.question} · v{item.version}</option>)}</select></label>
              {draft.duplicates.map(item => <details key={item.id}><summary className="cursor-pointer">{item.question} · {item.status} · {item.different_scope ? '范围不同，不能据此认定重复' : '候选'}{item.same_source ? ' · 同来源' : ''}</summary><p className="whitespace-pre-wrap">{item.answer}</p><p>出处：{item.source_name} · {item.source_url || '无链接'}</p><p>范围：{item.scope ? Object.values(item.scope).flat().join('；') : '历史条目未结构化，请核对原文'}</p></details>)}
              {!draft.duplicates.length && <p className="muted">未发现同类别相近问题；仍需人工核对。</p>}
              <button type="button" className="button-secondary" onClick={() => { setState(current => current && ({ ...current, drafts: current.drafts.map(d => d.id === draft.id ? { ...d, status: d.status === 'ignored' ? 'draft' : 'ignored' } : d) })); setDirty(true); publicationKey.current = ''; }}>{draft.status === 'ignored' ? '恢复草稿' : '忽略此草稿'}</button>
            </fieldset>
            <div className="notice text-sm"><b>{dirty ? '编辑后需保存以重新校验' : draft.validation.errors.length ? '存在发布阻碍' : '确定性检查通过，仍须人工审核'}</b>{!dirty && draft.validation.date_note && <p>{draft.validation.date_note}</p>}{draft.validation.errors.map((error, i) => <p className="notice-error" key={i}>{error}</p>)}{draft.validation.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>
          </article>)}
        </section>
      </div>
    </>}
  </div>;
}
