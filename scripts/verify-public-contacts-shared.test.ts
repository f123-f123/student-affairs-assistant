// 显式启用，仅只读共享 Supabase；不保存联系人，不写问答日志，不读取学生 events。
import { it, expect, vi } from 'vitest';
import { loadEnvConfig } from '@next/env';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../lib/supabase';
import { withCurrentContacts } from '../lib/answer-contacts';
import { publicContactFields } from '../lib/public-notice-contacts';
import { describeScope } from '../lib/knowledge-scope';
import type { AskResponse, KnowledgeItem } from '../lib/types';

it.skipIf(process.env.VERIFY_PUBLIC_CONTACTS_SHARED !== '1')('共享库只读核对公共通知联系人部署及问答解析', async () => {
  vi.stubEnv('NODE_ENV', 'development'); loadEnvConfig(process.cwd(), true);
  expect(process.env.DB_PROVIDER).toBe('supabase');
  const db = getSupabase(), batchId = '6012d1da-6a1d-4215-8f8d-7cae11d6ff0f';
  const [batch, contacts, privateRecords, items] = await Promise.all([
    db.from('knowledge_imports').select('id,title,contacts_version').eq('id', batchId).single(),
    db.from('contacts').select(publicContactFields).eq('scope', 'import').eq('notice_import_id', batchId),
    db.from('contacts').select('id,name,email,scope').in('id', ['daa0db06-e367-4366-821d-a4d4ef86333f', '8a317f59-913b-4df6-a49a-83da7645d01f']),
    db.from('knowledge_items').select('*').in('id', ['1cc79818-a08a-4c5b-ad36-7b2723c60b5e', '28d15658-ac10-4bce-b74b-e4a4d4142617']).eq('status', 'confirmed'),
  ]);
  for (const row of [batch, contacts, privateRecords, items]) expect(row.error).toBeNull();
  expect(privateRecords.data).toHaveLength(2); expect(privateRecords.data!.every(c => c.scope === 'notice')).toBe(true);
  expect(privateRecords.data!.every(c => c.name === '王老师' && c.email === 'zjuwangxu@zju.edu.cn')).toBe(true);
  expect(items.data!.length).toBeGreaterThan(0); const knowledge = items.data as KnowledgeItem[];
  const response: AskResponse = { answerable: true, status: 'answered', answer: knowledge[0].answer, citations: knowledge.map(item => ({ ...item, version: item.version || 1, source_excerpt: item.source_excerpt || null })), contacts: [], category_id: knowledge[0].category_id };
  const pending: AskResponse = { answerable: false, status: 'needs_scope', citations: [], contacts: [], category_id: knowledge[0].category_id,
    scope_candidates: [{ id: knowledge[0].id, version: knowledge[0].version || 1, label: describeScope(knowledge[0]), missing_fields: ['学院/学园', '年级', '年度/学年'], source_name: knowledge[0].source_name, source_url: knowledge[0].source_url }] };
  const [answer, clarification] = await withCurrentContacts(db, [response, pending]);
  expect(answer.notice_contact_groups).toHaveLength(1); expect(answer.notice_contact_groups![0].import_id).toBe(batchId);
  expect(clarification.scope_candidates![0].notice_contact_groups![0].import_id).toBe(batchId);
  expect(answer.answer).toBe(response.answer); expect(answer.citations).toEqual(response.citations);
  const approved = (contacts.data || []).some(contact => contact.review_status === 'confirmed');
  if (!approved) {
    expect(answer.notice_contact_groups![0]).toMatchObject({ state: 'unreviewed', contacts: [] });
    expect(clarification.scope_candidates![0].notice_contact_groups![0]).toMatchObject({ state: 'unreviewed', contacts: [] });
  } else {
    expect(answer.notice_contact_groups![0].contacts.some(c => c.name === '王老师' && c.email === 'zjuwangxu@zju.edu.cn')).toBe(true);
  }
  writeFileSync('artifacts/public-notice-contacts-20261019-shared.json', JSON.stringify({ checked_at: new Date().toISOString(), database: 'ujbflooavhhbtdezrteo', migration_deployed: true, shared_writes: 0, private_records_preserved: privateRecords.data!.length,
    public_contacts: contacts.data, batch: batch.data, answer_groups: answer.notice_contact_groups, clarification_groups: clarification.scope_candidates![0].notice_contact_groups,
    teacher_confirmation_pending: !approved, original_answer_and_citations_preserved: true, queried_events: false }, null, 2) + '\n');
}, 30_000);
