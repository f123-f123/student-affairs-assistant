import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ipaddr from 'ipaddr.js';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = argument('url') || 'https://yunfeng.zju.edu.cn/on/2026/1013/c53544a3213848/page.psp';
const base = argument('base') || 'http://127.0.0.1:3100';
const supabaseBase = argument('supabase-base');
const scenarios = [
  ...(argument('empty-base') ? [[argument('empty-base'), 'empty allowlist', 'FETCH_ALLOWLIST_EMPTY']] : []),
  ...(argument('system-base') ? [[argument('system-base'), 'system DNS with Fake-IP', 'FETCH_DNS_NON_PUBLIC']] : []),
  [base, 'explicit trusted DoH with public-IP pinning', 'FETCH_OK'],
];
for (const [origin] of scenarios) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Only local application acceptance servers are supported');
if (supabaseBase) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(supabaseBase).hostname));
const report = { target, checked_at: new Date().toISOString(), application: 'next start (production build)', scenarios: [] };

async function login(origin) {
  const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'student-a', passcode: '' }) });
  assert.equal(response.status, 200, 'Local evaluation login failed');
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('student_affairs_session='))?.split(';')[0];
  assert.ok(cookie); return cookie;
}
async function call(origin, cookie, path, body, method = 'POST') {
  const response = await fetch(origin + path, { method, headers: { Cookie: cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

for (const [origin, scenario, expected] of scenarios) {
  const cookie = await login(origin);
  const result = await call(origin, cookie, '/api/sources/diagnose', { url: target });
  console.log(scenario, result.status, result.body.code, result.body.error || '');
  assert.equal(result.body.code, expected, JSON.stringify(result.body));
  if (expected !== 'FETCH_OK') {
    assert.equal(result.status, expected === 'FETCH_ALLOWLIST_EMPTY' ? 503 : 422);
    report.scenarios.push({ scenario, status: result.status, ...result.body });
    continue;
  }
  assert.equal(result.status, 200);
  const article = result.body.article;
  assert.equal(article.diagnostics.dns_mode, 'doh');
  assert.equal(article.diagnostics.http_status, 200);
  for (const hop of article.diagnostics.hops) assert.equal(ipaddr.parse(hop.address).range(), 'unicast');
  assert.ok(result.body.text_length > 1000);
  assert.equal(article.completeness, 'body_only');
  for (const format of ['docx', 'doc']) assert.ok(article.attachments.some(item => item.format === format && item.status === 'unparsed'), `${format} attachment missing`);
  report.scenarios.push({ scenario, status: result.status, code: result.body.code, title: article.title,
    text_length: result.body.text_length, completeness: article.completeness, warning: article.warning,
    attachments: article.attachments, diagnostics: article.diagnostics });
  // 此分支只对独立启动、显式 DB_PROVIDER=sqlite / LOCAL_SQLITE_PATH=:memory: 的验收实例使用。
  if (!process.argv.includes('--with-isolated-storage')) continue;
  const created = await call(origin, cookie, '/api/sources', { name: '云峰真实链接验收', url: target, kind: 'article' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sourceId = created.body.id;
  const checked = await call(origin, cookie, `/api/sources/${sourceId}/check`);
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.results[0].status, 'new');
  const list = await call(origin, cookie, '/api/sources', undefined, 'GET');
  assert.equal(list.status, 200);
  const saved = list.body.articles.find(item => item.source_id === sourceId);
  assert.ok(saved); assert.equal(saved.completeness, 'body_only');
  assert.deepEqual(saved.attachments, article.attachments);
  const detail = await call(origin, cookie, `/api/sources/articles/${saved.id}`, undefined, 'GET');
  assert.equal(detail.status, 200); assert.equal(detail.body.article.source_text.length, result.body.text_length);
  const again = await call(origin, cookie, `/api/sources/${sourceId}/check`);
  assert.equal(again.status, 200); assert.equal(again.body.results[0].status, 'unchanged');
  const extraction = await call(origin, cookie, '/api/events/extract', { article_id: saved.id });
  assert.equal(extraction.status, 503, 'Disable LLM_API_KEY for this isolated acceptance instance');
  assert.equal(extraction.body.error_type, 'extract_failed');
  assert.equal(extraction.body.source.completeness, 'body_only');
  assert.deepEqual(extraction.body.source.attachments, article.attachments);
  report.storage_chain = { database: 'isolated SQLite :memory:', create: created.status, check: checked.status, list: list.status, detail: detail.status,
    repeat_check: again.body.results[0].status, saved_attachment_count: saved.attachments.length,
    extraction_without_model: { status: extraction.status, error_type: extraction.body.error_type, completeness: extraction.body.source.completeness, attachments_preserved: true },
    remote_database_written: false, attachments_downloaded: false, model_called: false };
}
if (supabaseBase) {
  const cookie = await login(supabaseBase);
  const result = await call(supabaseBase, cookie, '/api/sources', undefined, 'GET');
  assert.ok(result.status === 200 || result.body.code === 'SOURCE_SCHEMA_MIGRATION_REQUIRED', JSON.stringify(result.body));
  report.supabase_read_only_check = { status: result.status, code: result.body.code || 'SCHEMA_READY',
    migration_required: result.body.code === 'SOURCE_SCHEMA_MIGRATION_REQUIRED',
    migration: 'supabase/migration_notice_attachments.sql', database_written: false };
  console.log('Configured Supabase read-only check:', result.status, result.body.code || 'SCHEMA_READY');
}
const path = resolve('artifacts/notice-fetch-diagnostic.json');
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log('All real application fetch scenarios passed:', path);
