import type { ImportBatch } from './knowledge-import';
import type { Contact, NoticeContactCandidate } from './types';
import { noticeAudience } from './notice-scope';
import { noticeContactCandidates } from './notice-contacts';
import { sourceHash } from './contact-storage';

export type PublicContact = Contact & { category_id: string; notice_import_id: string; source_hash: string; source_url: string;
  source_excerpt: string; reviewed_scope: string; reviewed_by: string | null; reviewed_at: string | null; review_status: string };
export type ContactBatch = ImportBatch & { contacts_version: number };
export const publicContactFields = 'id,category_id,name,role,phone,email,office,office_hours,notice_import_id,source_hash,source_url,source_excerpt,reviewed_scope,reviewed_by,reviewed_at,review_status';
export const publicNoticeScope = (batch: ImportBatch) => [batch.title, noticeAudience(batch.source_text)].filter(Boolean).join('\n');
export function noticeSnapshot(batch: ImportBatch) {
  return { source_url: batch.source_url, title: batch.title, source_text: batch.source_text, published_date: batch.published_date,
    date_candidates: batch.date_candidates.map(c => ({ date: c.date, kind: c.kind, evidence: c.evidence })),
    attachments: batch.attachments.map(a => ({ name: a.name, url: a.url, format: a.format, status: a.status })) };
}
export const publicNoticeHash = (batch: ImportBatch) => sourceHash(JSON.stringify(noticeSnapshot(batch)));
export function matchesNoticeCandidate(batch: ImportBatch, contact: Pick<PublicContact, 'name' | 'role' | 'email' | 'phone' | 'source_excerpt'>) {
  return !!contact.source_excerpt && batch.source_text.includes(contact.source_excerpt) && noticeContactCandidates(contact.source_excerpt).some(candidate =>
    candidate.name === contact.name && candidate.role === contact.role && candidate.email === contact.email && candidate.phone === contact.phone);
}
export function validPublicContact(batch: ImportBatch, contact: PublicContact) {
  return contact.review_status === 'confirmed' && !!contact.reviewed_by && !!contact.reviewed_at && contact.notice_import_id === batch.id
    && !contact.office && !contact.office_hours
    && contact.source_hash === publicNoticeHash(batch) && contact.source_url === batch.source_url && contact.reviewed_scope === publicNoticeScope(batch) && matchesNoticeCandidate(batch, contact);
}
export function publicContactId(batchId: string, candidate: NoticeContactCandidate) {
  const hex = sourceHash(JSON.stringify([batchId, candidate.name, candidate.email?.toLowerCase() || '', candidate.phone || '']));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const contactCard = ({ id, name, role, phone, email, office, office_hours }: Contact): Contact => ({ id, name, role, phone, email, office, office_hours });
