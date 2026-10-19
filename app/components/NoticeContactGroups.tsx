'use client';
import type { NoticeContactGroup } from '@/lib/types';
import ContactCard from './ContactCard';

export default function NoticeContactGroups({ groups, pending = false, onRetry }: { groups: NoticeContactGroup[]; pending?: boolean; onRetry?: () => void }) {
  return <div className="space-y-3">{groups.map((group, i) => <section className="content-card space-y-2 text-sm" key={group.import_id || group.item_ids[0] || i} aria-label="该通知联系人">
    <h3 className="font-semibold">{pending ? '该通知联系人' : '本通知联系人'} · {group.title}</h3>
    {group.scope_label && <p className="muted whitespace-pre-wrap">咨询范围：{group.scope_label}</p>}
    {pending && <p className="notice notice-warning">咨询范围尚待确认，展示该通知联系人不代表你符合申请资格。</p>}
    {group.state === 'unavailable' ? <p className="notice notice-error" role="alert">联系人读取失败，当前无法确认审核状态。{onRetry && <button type="button" className="underline" onClick={onRetry}>重试读取联系人</button>}</p>
      : group.state === 'source_changed' ? <p className="notice notice-warning">来源依据或引用范围已变化，联系人需要老师重新核对，暂不展示旧联系方式。</p>
        : group.state === 'unlinked' ? <p className="muted">该知识尚未建立公共通知联系人关联，请老师核对导入批次；不会使用私人事项联系人。</p>
          : group.state === 'unreviewed' ? <p className="muted">本通知尚未审核联系人</p> : group.contacts.map(contact => <ContactCard key={contact.id} contact={contact} />)}
    {!group.contacts.length && <div className="space-y-2 border-t pt-2"><p className="font-semibold">类别咨询负责人（提供本类别一般咨询，并非本通知专属联系人）</p>{group.category_error ? <p className="notice notice-error">类别咨询负责人读取失败，请重试。</p> : group.category_contacts.length ? group.category_contacts.map(contact => <ContactCard key={contact.id} contact={contact} />) : <p className="muted">类别暂无咨询负责人，可提交工单请老师协助。</p>}</div>}
  </section>)}</div>;
}
