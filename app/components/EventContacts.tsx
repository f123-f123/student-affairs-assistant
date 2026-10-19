'use client';
import { useEffect, useState } from 'react';
import type { Contact, EventDraft } from '@/lib/types';
import { noticeContactCandidates } from '@/lib/notice-contacts';
import { noticeAudience } from '@/lib/notice-scope';
import ContactCard from './ContactCard';

export default function EventContacts({ value, onChange }: { value: EventDraft; onChange?: (value: EventDraft) => void }) {
  const [options, setOptions] = useState<{ categories: { id: string; name: string }[]; contacts: (Contact & { category_id: string })[]; notice_supported: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!onChange) return;
    const controller = new AbortController();
    void fetch('/api/events/contact-options', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('类别和负责人选项读取失败');
      setOptions(await response.json());
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [!!onChange]);
  const candidates = noticeContactCandidates(value.source_text);
  const audience = noticeAudience(value.source_text);
  const categoryRows = onChange && options ? options.contacts.filter(contact => contact.category_id === value.category_id) : value.category_contacts;
  const queryFailed = !!error || value.notice_contacts_error === 'CONTACTS_UNAVAILABLE';
  return <section className="space-y-3" aria-label="事项联系人"><h3>事项联系人</h3>
    <p className="notice text-sm">{audience && <>原文通知对象：“{audience}”。</>}申请要求和本通知联系人仅适用于该通知所列单位及对象，不代表其他学院；类别咨询负责人仅提供咨询，不代表其他学院适用同一要求。</p>
    {onChange && options && <label className="field-label">事项类别（仅用于没有通知联系人时的咨询负责人）<select className="field" value={value.category_id || ''} onChange={event => onChange({ ...value, category_id: event.target.value || null, category_contacts: [] })}><option value="">尚未选择类别</option>{options.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {(value.notice_contacts_error || options?.notice_supported === false) && <p className="notice notice-warning">{value.notice_contacts_error === 'CONTACTS_UNAVAILABLE' ? '联系人查询失败，不能据此判断尚未配置。' : value.notice_contacts_error === 'NOTICE_CONTACT_SOURCE_CHANGED' ? '通知原文已变化，本通知联系人需要老师重新核对。' : '通知联系人关联尚未部署；需要管理员执行增量迁移，不能把本通知联系人保存成整个类别负责人。'}</p>}
    {!!value.notice_contacts?.length ? <><h4>本通知联系人（已由老师核对）</h4>{value.notice_contacts.map(contact => <ContactCard key={contact.id} contact={contact} />)}</>
      : categoryRows?.length ? <><h4>类别咨询负责人（非本通知联系人）</h4>{categoryRows.map(contact => <ContactCard key={contact.id} contact={contact} />)}</>
        : !queryFailed && <p className="muted">本通知尚无已确认联系人；类别咨询负责人也尚未配置或未选择类别。</p>}
    {candidates.length > 0 && <details><summary className="min-h-11 cursor-pointer">原文联系人候选（待老师核对）</summary><p className="muted text-sm">候选由代码直接识别，不由模型补写；尚未入库，不提供联系按钮。先保存事项，再由老师在知识库的“本通知联系人”入口确认。</p>{candidates.map((candidate, index) => <div key={index} className="notice mt-2"><b>{candidate.name || '原文未明确姓名'}</b><p>{candidate.email || candidate.phone}</p><p className="whitespace-pre-wrap">依据：{candidate.source_excerpt}</p></div>)}</details>}
  </section>;
}
