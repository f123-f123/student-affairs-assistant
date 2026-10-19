// 显式开启才调用真实抓取/模型；始终只读共享数据库，绝不发布真实通知。
import { it, expect, vi } from 'vitest';
import { loadEnvConfig } from '@next/env';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { fetchNotice } from '../lib/safe-fetch';
import { generateOfficialKnowledge } from '../lib/llm';
import { checkImportDraft, completeImportScope, parseImportGeneration, type ImportBatch } from '../lib/knowledge-import';

it.skipIf(process.env.VERIFY_OFFICIAL_IMPORT_LIVE !== '1')('真实抓取与模型整理（不写共享知识库）', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  loadEnvConfig(process.cwd(), true);
  const timings: Record<string, number> = {};
  const start = performance.now();
  const fetched = await fetchNotice('https://yunfeng.zju.edu.cn/on/2026/1013/c53544a3213792/page.psp', (process.env.ALLOWED_FETCH_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean));
  timings.fetch_ms = Math.round(performance.now() - start);
  const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
  const categories = await db.from('categories').select('id,name'); expect(categories.error).toBeNull();
  const deployment = await db.from('knowledge_imports').select('id').limit(1);
  const batch = { id: '00000000-0000-4000-8000-000000000001', owner_id: 'readonly-verification', requested_url: fetched.sourceUrl, source_url: fetched.sourceUrl,
    title: fetched.title, source_text: fetched.sourceText, published_date: fetched.publishedDate, date_candidates: fetched.dateCandidates, attachments: fetched.attachments,
    fetched_at: fetched.fetchedAt, content_hash: null, status: 'fetched', error_code: null, error_message: null, version: 1 } as ImportBatch;
  const modelStart = performance.now();
  const raw = await generateOfficialKnowledge(batch, categories.data!);
  timings.model_ms = Math.round(performance.now() - modelStart);
  const drafts = parseImportGeneration(raw).map(data => completeImportScope(batch, data));
  const checks = drafts.map(data => ({ data, validation: checkImportDraft(batch, data, categories.data!), after_explicit_review: checkImportDraft(batch,
    { ...data, date_confirmed: true, scope_confirmed: true, semantics_confirmed: true }, categories.data!, true) }));
  writeFileSync('artifacts/official-import-auto-year-20261019-live.json', JSON.stringify({ checked_at: new Date().toISOString(), shared_schema_deployed: !deployment.error,
    shared_schema_error: deployment.error?.code || null, shared_writes: 0, timings, batch, drafts: checks }, null, 2) + '\n');
  expect(drafts).toHaveLength(1);
  expect(checks[0].validation.errors).toEqual([]);
  expect(checks[0].validation.date_note).toContain('自动补全年份');
  expect(checks[0].validation.issues.some(issue => /未写明?年份|确认具体年度/.test(issue))).toBe(false);
  expect(drafts.every(data => data.question.includes('云峰学园') && data.answer.includes('云峰学园') && data.question.includes('2025级') && data.answer.includes('2025级') && data.question.includes('2025-2026') && data.answer.includes('2025-2026'))).toBe(true);
  console.info('Real import verification', { timings, count: drafts.length, blocked: checks.filter(c => c.validation.errors.length).length, shared_schema_deployed: !deployment.error, shared_writes: 0 });
}, 90_000);
