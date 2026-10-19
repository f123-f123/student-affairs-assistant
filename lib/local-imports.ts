import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { checkImportDraft, type ImportBatch, type ImportDraft, type ImportData } from './knowledge-import';

type Row = Record<string, any>;
const conflict = (id: unknown, reason: string): never => { throw new Error(`IMPORT_CONFLICT:${id}:${reason}`); };
export function localImportRpc(db: DatabaseSync, name: string, p: Row) {
  if (!['capture_knowledge_import', 'edit_knowledge_import', 'publish_knowledge_import'].includes(name)) return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    let result: unknown = null;
    if (name === 'capture_knowledge_import') {
      const data = p.p_data;
      const old = data.content_hash && db.prepare('SELECT id FROM knowledge_imports WHERE source_url=? AND content_hash=?').get(data.source_url, data.content_hash) as Row | undefined;
      const id = old?.id || randomUUID();
      if (!old) db.prepare('INSERT INTO knowledge_imports(id,owner_id,requested_url,source_url,title,source_text,published_date,date_candidates,attachments,fetched_at,content_hash,status,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, data.owner_id, data.requested_url, data.source_url, data.title, data.source_text, data.published_date, JSON.stringify(data.date_candidates), JSON.stringify(data.attachments), data.fetched_at, data.content_hash, data.status, data.error_code, data.error_message);
      result = { id, existing: !!old };
    } else {
      const raw = db.prepare('SELECT * FROM knowledge_imports WHERE id=?').get(p.p_batch_id) as Row | undefined;
      if (!raw) conflict(p.p_batch_id, 'batch_missing');
      const batch = { ...raw, date_candidates: JSON.parse(raw!.date_candidates), attachments: JSON.parse(raw!.attachments) } as ImportBatch;
      if (name === 'edit_knowledge_import') {
        if (raw!.version !== p.p_expected_version) conflict(p.p_batch_id, 'batch_version');
        if (!Array.isArray(p.p_drafts) || p.p_drafts.length < 1 || p.p_drafts.length > 8) conflict(p.p_batch_id, 'draft_limit');
        if (p.p_mode === 'generate') {
          if (db.prepare('SELECT id FROM knowledge_import_drafts WHERE batch_id=?').get(p.p_batch_id)) conflict(p.p_batch_id, 'drafts_exist');
          for (const d of p.p_drafts) db.prepare('INSERT INTO knowledge_import_drafts(id,batch_id,data) VALUES (?,?,?)').run(d.id, p.p_batch_id, JSON.stringify(d.data));
        } else if (p.p_mode === 'edit') {
          for (const d of p.p_drafts) {
            const old = db.prepare('SELECT * FROM knowledge_import_drafts WHERE id=? AND batch_id=?').get(d.id, p.p_batch_id) as Row | undefined;
            if (!old || old.status === 'published' || old.version !== d.version) conflict(d.id, 'draft_version');
            db.prepare('UPDATE knowledge_import_drafts SET data=?,status=?,version=version+1 WHERE id=?').run(JSON.stringify(d.data), d.status, d.id);
          }
        } else conflict(p.p_batch_id, 'invalid_action');
        db.prepare("UPDATE knowledge_imports SET status='review',version=version+1,error_code=NULL,error_message=NULL WHERE id=?").run(p.p_batch_id);
      } else {
        const receipt = db.prepare('SELECT * FROM knowledge_import_publications WHERE id=?').get(p.p_request_id) as Row | undefined;
        if (receipt) {
          if (receipt.batch_id !== p.p_batch_id || receipt.entries !== JSON.stringify(p.p_entries) || receipt.reviewed_by !== p.p_actor) conflict(p.p_request_id, 'request_reused');
          result = JSON.parse(receipt.result);
        } else {
          const ids: string[] = [], targets = new Set<string>();
          if (!p.p_entries.length || p.p_entries.length > 8) conflict(p.p_batch_id, 'empty_selection');
          for (const entry of p.p_entries) {
            const old = db.prepare('SELECT * FROM knowledge_import_drafts WHERE id=? AND batch_id=?').get(entry.id, p.p_batch_id) as Row | undefined;
            if (!old || old.status === 'ignored' || old.version !== entry.version || old.data !== JSON.stringify(entry.data)) conflict(entry.id, 'draft_version');
            if (old!.status === 'published') { ids.push(old!.published_item_id); continue; }
            const data = JSON.parse(old!.data) as ImportData;
            const validation = checkImportDraft(batch, data, db.prepare('SELECT id,name FROM categories').all() as { id: string; name: string }[], true);
            if (validation.errors.length) conflict(entry.id, `validation:${validation.errors.join('|')}`);
            if (data.supersedes) {
              const previous = db.prepare('SELECT * FROM knowledge_items WHERE id=?').get(data.supersedes) as Row | undefined;
              if (!previous || previous.status !== 'confirmed' || previous.version !== data.replacement_version || previous.category_id !== data.category_id || targets.has(data.supersedes)) conflict(entry.id, 'replacement_version');
              const scope = previous!.scope ? JSON.parse(previous!.scope) : null;
              if (scope && ['units', 'cohorts', 'years', 'projects'].some(key => scope[key]?.length && data.scope[key as keyof typeof data.scope].length && [...scope[key]].sort().join('|') !== [...data.scope[key as keyof typeof data.scope]].sort().join('|'))) conflict(entry.id, 'replacement_scope');
              if (!scope && ['units', 'cohorts', 'years', 'projects'].some(key => data.scope[key as keyof typeof data.scope].some(term => !`${previous!.question}${previous!.answer}`.replace(/[—–至]/g, '-').includes(term.replace(/[—–至]/g, '-'))))) conflict(entry.id, 'replacement_scope_unknown');
              targets.add(data.supersedes);
            }
            db.prepare("INSERT INTO knowledge_items(id,category_id,question,answer,aliases,source_level,source_name,source_url,source_excerpt,scope,facts,import_draft_id,status,reviewed_by,reviewed_at,supersedes) VALUES (?,?,?,?,?,2,?,?,?,?,?,?,'confirmed',?,?,?)")
              .run(entry.id, data.category_id, data.question, data.answer, JSON.stringify(data.aliases), batch.title, batch.source_url, data.excerpts.join('\n\n'), JSON.stringify(data.scope), JSON.stringify(validation.facts), entry.id, p.p_actor, new Date().toISOString(), data.supersedes);
            if (data.supersedes) db.prepare("UPDATE knowledge_items SET status='superseded' WHERE id=?").run(data.supersedes);
            db.prepare("UPDATE knowledge_import_drafts SET status='published',published_item_id=id,reviewed_by=?,reviewed_at=? WHERE id=?").run(p.p_actor, new Date().toISOString(), entry.id);
            ids.push(entry.id);
          }
          db.prepare('INSERT INTO knowledge_import_publications(id,batch_id,entries,result,reviewed_by) VALUES (?,?,?,?,?)').run(p.p_request_id, p.p_batch_id, JSON.stringify(p.p_entries), JSON.stringify({ ids, count: ids.length }), p.p_actor);
          result = { ids, count: ids.length };
          db.prepare("UPDATE knowledge_imports SET status=CASE WHEN EXISTS(SELECT 1 FROM knowledge_import_drafts WHERE batch_id=? AND status='draft') THEN 'review' ELSE 'published' END WHERE id=?").run(p.p_batch_id, p.p_batch_id);
        }
      }
    }
    db.exec('COMMIT'); return { data: result, error: null };
  } catch (cause) { db.exec('ROLLBACK'); return { data: null, error: { message: cause instanceof Error ? cause.message : 'import_failed' } }; }
}
