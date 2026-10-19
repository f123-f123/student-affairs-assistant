'use client';
import { useEffect, useState } from 'react';
import type { NoticeContactCandidate } from '@/lib/types';
import type { PublicContact } from '@/lib/public-notice-contacts';
import ContactCard from './ContactCard';

type Candidate = NoticeContactCandidate & { id: string; private_matches: number };
type Review = { contacts: (PublicContact & { valid: boolean })[]; candidates: Candidate[]; version: number; source_hash: string; scope_label: string; source_changed: boolean; status: string };
export default function ImportNoticeContacts({ batchId, categoryId, knowledgeStatus, disabled, onLocate }: {
  batchId: string; categoryId: string; knowledgeStatus: string; disabled: boolean; onLocate: (excerpt: string) => void;
}) {
  const [review, setReview] = useState<Review | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState<string[]>([]);
  async function load() {
    setError('');
    try { const response = await fetch(`/api/teacher/imports/${batchId}/contacts`, { cache: 'no-store' }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || '联系人读取失败');
      if (!Array.isArray(body.contacts) || !Array.isArray(body.candidates) || !Number.isInteger(body.version)) throw new Error('联系人读取失败：服务响应格式无效');
      setReview(body); setConfirmed([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '联系人读取失败'); }
  }
  useEffect(() => { setReview(null); setConfirmed([]); void load(); }, [batchId]);
  async function save(candidate: Candidate, action = 'approve') {
    if (!review || busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/teacher/imports/${batchId}/contacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        action, version: review.version, source_hash: review.source_hash, confirm_source: true,
        contact: action === 'approve' ? { ...candidate, category_id: categoryId, office: null, office_hours: null } : { id: candidate.id },
      }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || '保存联系人失败'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存联系人失败'); } finally { setBusy(false); }
  }
  return <section className="panel space-y-3" aria-label="本通知联系人审核"><h2>本通知联系人</h2>
    <p className="muted text-sm">知识状态：{knowledgeStatus}；联系人审核独立进行。这里只从原文识别候选，勾选确认保存后才公开到本通知问答。</p>
    {error && <p className="notice notice-error" role="alert">{error}<button className="underline ml-2" type="button" disabled={busy || disabled} onClick={() => void load()}>重试联系人读取</button></p>}
    {!review && !error && <p className="muted">正在读取本通知联系人…</p>}
    {review && <><p>联系人状态：{review.status === 'confirmed' ? '已审核' : review.status === 'source_changed' ? '依据变化，待重新核对' : '本通知尚未审核联系人'}</p><p className="notice whitespace-pre-wrap text-sm">本次公开的通知范围：{review.scope_label}</p>
      {review.source_changed && <p className="notice notice-warning">同来源已有新快照，请选择最新导入批次核对，不会自动沿用旧联系人。</p>}
      {!review.candidates.length && <p className="muted">原文没有可靠的姓名及邮箱/电话候选，不补写联系方式，可保留空状态并提交工单。</p>}
      {review.candidates.map(candidate => {
        const saved = review.contacts.find(contact => contact.id === candidate.id), checked = confirmed.includes(candidate.id);
        return <div key={candidate.id} className="content-card space-y-2">
          <p className="font-semibold">原文候选：{candidate.name || '未识别姓名，暂不能确认'} · {candidate.email || candidate.phone}</p>
          <p className="whitespace-pre-wrap text-sm">原文依据：{candidate.source_excerpt}</p><button type="button" className="button-quiet" onClick={() => onLocate(candidate.source_excerpt)}>定位原文依据 ↗</button>
          {candidate.private_matches > 0 && <p className="notice notice-warning text-sm">同 URL 的私人事项存在相同联系人，仅作为匹配线索。已与公开原文候选比对；仍需老师核对姓名、联系方式和通知范围后明确确认。私人记录不会修改或改为类别负责人。</p>}
          {saved?.valid ? <><p className="notice">联系人已审核 · {saved.reviewed_at}</p><ContactCard contact={saved} /><button type="button" className="button-secondary" disabled={busy || disabled} onClick={() => void save(candidate, 'revoke')}>撤销本通知联系人审核</button></>
            : <><label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy || disabled || review.source_changed || !candidate.name || !candidate.role} onChange={event => setConfirmed(current => event.target.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id))} />我已核对公开原文、姓名和联系方式及上述通知范围，确认建立公共通知联系人关联</label><button type="button" className="button-primary" disabled={busy || disabled || !checked || !categoryId || review.source_changed} onClick={() => void save(candidate)}>{busy ? '保存联系人中…' : '确认并保存本通知联系人'}</button></>}
        </div>;
      })}</>}
  </section>;
}
