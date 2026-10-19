// 仅供明确指定的隔离SQLite测试实例。真实通知绝不发布到共享Supabase。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dbArgument = process.argv.find(v => v.startsWith('--isolated-db='))?.slice('--isolated-db='.length);
if (!dbArgument) throw new Error('必须明确指定 --isolated-db=测试SQLite文件');
const filename = path.resolve(dbArgument), root = path.resolve('artifacts') + path.sep;
if (!filename.startsWith(root) || !fs.existsSync(filename)) throw new Error('只允许artifacts目录内已存在的隔离测试数据库');
const db = new DatabaseSync(filename, { readOnly: true });
const saved = db.prepare('SELECT id,source_url FROM knowledge_imports ORDER BY created_at DESC LIMIT 1').get();
const before = { batches: db.prepare('SELECT count(*) n FROM knowledge_imports').get().n, drafts: db.prepare('SELECT count(*) n FROM knowledge_import_drafts').get().n,
  knowledge: db.prepare('SELECT count(*) n FROM knowledge_items').get().n, events: db.prepare('SELECT count(*) n FROM events').get().n };
if (!saved?.source_url?.endsWith('/c53544a3213792/page.psp')) throw new Error('隔离样例不是已核对的云峰学园通知');
const base = 'http://localhost:3000';
async function login(identity) {
  const r = await fetch(base + '/api/auth/mock-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity }) });
  if (!r.ok) throw new Error('只允许已显式配置mock鉴权的隔离实例');
  return r.headers.get('set-cookie').split(';')[0];
}
async function api(route, cookie, method = 'GET', data) {
  const r = await fetch(base + route, { method, headers: { cookie, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify({ status: r.status, ...result }));
  return { data: result, timing: r.headers.get('server-timing') };
}
try {
  const teacher = await login('teacher');
  let state = (await api('/api/teacher/imports/' + saved.id, teacher)).data;
  if (state.batch.id !== saved.id || state.batch.source_url !== saved.source_url) throw new Error('API与指定SQLite不一致，停止写入');
  const deadline = state.drafts.find(d => d.data.question.includes('截止'));
  if (!deadline) throw new Error('未找到截止时间草稿');
  let publication = { already_published: true };
  if (deadline.status !== 'published') {
    const data = deadline.data, prefix = [...data.scope.units, ...data.scope.cohorts, ...data.scope.years, ...data.scope.projects].join('、');
    const evidence = '个人申请截止时间：10月18日（周日）17：30';
    if (!state.batch.source_text.includes(evidence) || !state.batch.date_candidates.some(d => d.date === '2026-10-13')) throw new Error('原文或日期依据变化，停止发布');
    const reviewed = { ...data, answer: prefix + '的个人申请截止时间为2026年10月18日17:30（上海时间）。' + data.scope.conditions.join('。'),
      excerpts: [...new Set([...data.excerpts, evidence, '各位云峰学园2025级同学'])], publication_date: '2026-10-13',
      date_confirmed: true, scope_confirmed: true, semantics_confirmed: true, issues: [] };
    await api('/api/teacher/imports/' + saved.id, teacher, 'PATCH', { version: state.batch.version, drafts: [{ id: deadline.id, version: deadline.version, status: 'draft', data: reviewed }] });
    state = (await api('/api/teacher/imports/' + saved.id, teacher)).data;
    const current = state.drafts.find(d => d.id === deadline.id);
    if (current.validation.errors.length) throw new Error('截止草稿未通过校验：' + current.validation.errors.join(';'));
    publication = await api('/api/teacher/imports/' + saved.id + '/publish', teacher, 'POST', { request_id: randomUUID(), drafts: [{ id: current.id, version: current.version }] });
  }
  const student = await login('student-a');
  const conversation = (await api('/api/conversations', student, 'POST', {})).data.conversation.id;
  const questions = ['云峰学园2025级2025-2026学年浙江大学二等奖学金的参评条件是什么？', '什么时候截止', '还能申请吗', '找谁', '那医学院奖学金怎么办理？', '什么时候截止', '云峰学园2025级2025-2026学年浙江大学二等奖学金申请什么时候开始？'];
  const answers = [];
  for (const question of questions) {
    const result = await api('/api/ask', student, 'POST', { question, conversation_id: conversation });
    answers.push({ question, response: result.data, timing: result.timing });
  }
  const counts = { batches: db.prepare('SELECT count(*) n FROM knowledge_imports').get().n, drafts: db.prepare('SELECT count(*) n FROM knowledge_import_drafts').get().n,
    knowledge: db.prepare('SELECT id,source_level,source_name,reviewed_by,valid_from,valid_until FROM knowledge_items').all(),
    events: db.prepare('SELECT count(*) n FROM events').get().n, contacts: db.prepare('SELECT count(*) n FROM contacts').get().n,
    conversations: db.prepare('SELECT count(*) n FROM conversations').get().n, chat_logs: db.prepare('SELECT count(*) n FROM chat_logs').get().n };
  const result = { checked_at: new Date().toISOString(), environment: 'isolated SQLite browser/API verification; NOT shared Supabase',
    before, after: counts, deadline_publication: publication, answers, shared_writes: 0,
    test_logs: 'Only the isolated database has test conversations/ask logs; no shared tickets or logs.' };
  fs.writeFileSync('artifacts/official-import-20261019-browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ count: counts.knowledge.length, shared_writes: 0, answers: answers.map(a => ({ question: a.question, answerable: a.response.answerable, answer: a.response.answer, notice: a.response.notice, timing: a.timing })) }, null, 2));
  if (!answers[0].response.answerable || !answers[1].response.answer?.includes('截止时间已过') || !answers[2].response.answer?.includes('不能据此推断允许补报') || answers[4].response.answerable || answers[5].response.answerable) throw new Error('真实问答验收未全部通过，请检查交付证据');
} finally { db.close(); }
