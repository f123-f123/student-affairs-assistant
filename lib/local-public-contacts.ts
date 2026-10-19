import type { DatabaseSync } from 'node:sqlite';
import { matchesNoticeCandidate, noticeSnapshot, publicNoticeHash, publicNoticeScope, type ContactBatch } from './public-notice-contacts';

export function localPublicContactRpc(db: DatabaseSync, name: string, p: Record<string, any>) {
  if (name !== 'review_import_contact') return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM knowledge_imports WHERE id=?').get(p.p_batch_id) as Record<string, any> | undefined;
    if (!row || row.contacts_version !== p.p_expected_version) throw new Error('PUBLIC_CONTACT_CONFLICT');
    const batch = { ...row, date_candidates: JSON.parse(row.date_candidates), attachments: JSON.parse(row.attachments) } as ContactBatch;
    if (JSON.stringify(noticeSnapshot(batch)) !== JSON.stringify(p.p_snapshot) || publicNoticeHash(batch) !== p.p_hash || publicNoticeScope(batch) !== p.p_scope) throw new Error('PUBLIC_CONTACT_SOURCE_CHANGED');
    const c = p.p_contact;
    if (p.p_action === 'revoke') {
      if (!db.prepare("SELECT id FROM contacts WHERE id=? AND scope='import' AND notice_import_id=?").get(c.id, batch.id)) throw new Error('PUBLIC_CONTACT_NOT_FOUND');
      db.prepare("UPDATE contacts SET review_status='revoked',reviewed_by=?,reviewed_at=? WHERE id=?").run(p.p_actor, new Date().toISOString(), c.id);
    } else if (p.p_action === 'approve') {
      if (!matchesNoticeCandidate(batch, c)) throw new Error('PUBLIC_CONTACT_EVIDENCE');
      const old = db.prepare('SELECT scope,notice_import_id FROM contacts WHERE id=?').get(c.id) as Record<string, any> | undefined;
      if (old && (old.scope !== 'import' || old.notice_import_id !== batch.id)) throw new Error('PUBLIC_CONTACT_CONFLICT');
      db.prepare("INSERT INTO contacts(id,category_id,name,role,email,phone,scope,notice_import_id,source_url,source_excerpt,source_hash,reviewed_scope,reviewed_by,reviewed_at,review_status) VALUES(?,?,?,?,?,?,'import',?,?,?,?,?,?,?,'confirmed') ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,role=excluded.role,email=excluded.email,phone=excluded.phone,office=null,office_hours=null,source_url=excluded.source_url,source_excerpt=excluded.source_excerpt,source_hash=excluded.source_hash,reviewed_scope=excluded.reviewed_scope,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,review_status='confirmed'")
        .run(c.id, c.category_id, c.name, c.role, c.email, c.phone, batch.id, batch.source_url, c.source_excerpt, p.p_hash, p.p_scope, p.p_actor, new Date().toISOString());
    } else throw new Error('PUBLIC_CONTACT_ACTION');
    db.prepare('UPDATE knowledge_imports SET contacts_version=contacts_version+1 WHERE id=?').run(batch.id);
    db.exec('COMMIT'); return { data: { id: c.id, contacts_version: batch.contacts_version + 1 }, error: null };
  } catch (error) { db.exec('ROLLBACK'); return { data: null, error: { message: error instanceof Error ? error.message : 'public_contact_failed' } }; }
}
