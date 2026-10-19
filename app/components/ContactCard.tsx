'use client';
import { useState } from 'react';
import type { Contact } from '@/lib/types';
import { isDemoContact } from '@/lib/contact-input';

export default function ContactCard({ contact }: { contact: Contact }) {
  const demo = isDemoContact(contact);
  const [copyResult, setCopyResult] = useState('');
  return <div className="content-card text-sm">
    <div className="font-semibold">{contact.name} <span className="muted font-normal">{contact.role === 'teacher' ? '老师' : '学生负责人'}</span></div>
    {demo && <p className="notice notice-warning">演示联系人，非真实联系方式</p>}
    {contact.phone && <div className="mt-1">电话：{demo ? <span>{contact.phone}（演示）</span> : <a href={`tel:${contact.phone}`}>{contact.phone}</a>}</div>}
    {contact.email && <div>邮箱：{demo ? <span>{contact.email}（演示）</span> : <a href={`mailto:${contact.email}`}>{contact.email}</a>}</div>}
    {contact.email && !demo && <div className="flex flex-wrap gap-2"><button type="button" className="button-secondary" onClick={() => {
      if (!navigator.clipboard) { setCopyResult('此环境无法自动复制，请手动复制邮箱'); return; }
      void navigator.clipboard.writeText(contact.email!).then(() => setCopyResult('邮箱已复制')).catch(() => setCopyResult('复制失败，请手动复制邮箱'));
    }}>复制邮箱</button><a className="button-secondary" href={`mailto:${contact.email}`}>发送邮件</a>{copyResult && <span role="status">{copyResult}</span>}</div>}
    {contact.office && <div>办公地点：{contact.office}</div>}
    {contact.office_hours && <div>办公时间：{contact.office_hours}</div>}
  </div>;
}
