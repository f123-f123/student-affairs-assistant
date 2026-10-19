import { readFile, writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

// 专用演示批次导入器：默认只读；不使用 upsert、发布审核 RPC 或通用 SQL 接口。
nextEnv.loadEnvConfig(process.cwd(), true);
const manifestPath = new URL('../artifacts/demo-knowledge-20261016.json', import.meta.url);
const auditPath = new URL('../artifacts/demo-knowledge-20261016-import.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const target = process.env.SUPABASE_URL;
if (process.env.DB_PROVIDER !== 'supabase' || !key || !target || new URL(target).origin !== manifest.target) {
  throw new Error('目标数据库不明确或与清单不一致；停止，不回退 SQLite。');
}
const markers = ['NODE_ENV', 'APP_ENV', 'ENVIRONMENT', 'DEPLOY_ENV', 'DEPLOYMENT_ENV', 'VERCEL_ENV', 'CONTEXT', 'SUPABASE_PROJECT_NAME', 'PROJECT_NAME'];
if (markers.some(name => /production|(^|[-_])prod($|[-_])|正式|生产/i.test(process.env[name] || ''))) {
  throw new Error('发现正式环境标识，停止导入。');
}
const db = createClient(target, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fields = 'id,category_id,question,answer,aliases,source_name,source_level,source_url,source_excerpt,valid_from,valid_until,supersedes,origin_event_id,version,reviewed_at,reviewed_by,status';
async function checked(query, operation) {
  const result = await query;
  if (result.error) throw new Error(`${operation}失败（${result.error.code || 'connection_error'}）；未自动修复结构。`);
  return result;
}
async function allKnowledge() {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const result = await checked(db.from('knowledge_items').select(fields).order('id').range(start, start + 499), '知识 SELECT');
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}
const [categories, existing, schemaResponse] = await Promise.all([
  checked(db.from('categories').select('id,name'), '类别 SELECT').then(result => result.data),
  allKnowledge(),
  fetch(new URL('/rest/v1/', target), { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(15000) }),
]);
if (!schemaResponse.ok) throw new Error(`不能确认实际表结构：HTTP ${schemaResponse.status}`);
const schema = await schemaResponse.json();
const columns = schema.definitions?.knowledge_items?.properties;
if (!columns || fields.split(',').some(field => !columns[field])) throw new Error('实际知识表字段与导入清单不符，停止。');
await Promise.all(['contacts', 'knowledge_item_versions', 'tickets', 'conversations', 'chat_logs'].map(table =>
  checked(db.from(table).select('*', { count: 'exact', head: true }), `${table}存在性检查`)));

const source = Object.fromEntries(['source_name', 'source_url', 'source_level', 'status', 'reviewed_by', 'reviewed_at', 'valid_from', 'valid_until', 'supersedes', 'origin_event_id', 'version'].map(field => [field, manifest[field]]));
const excluded = /缓考|延期考试|推迟考试|延后.{0,3}(?:考|考试)|考试.{0,8}(?:冲突|延期|延后)|宿舍调换|调换宿舍|换寝室|换宿舍|调宿|调寝/;
const normalize = value => value.replace(/[\s\p{P}\p{S}]/gu, '').replace(/演示中(?:的)?|演示|如何|怎么|哪些|什么|需要|申请|办理|流程|步骤|材料|清单|准备|提供|提交|后/g, '');
const heading = item => [item.question, ...(item.aliases || [])].map(normalize);
const records = manifest.items.map(({ category, topic, ...item }) => ({ ...item, ...source }));
const seenIds = new Set();
for (const [index, record] of records.entries()) {
  const item = manifest.items[index];
  if (seenIds.has(record.id)) throw new Error('清单存在重复 ID');
  seenIds.add(record.id);
  if (!categories.some(row => row.id === record.category_id && row.name === item.category)) throw new Error(`未找到匹配的已有类别：${item.category}`);
  if (record.source_name !== '演示办事指南（虚构，非学校正式规定）' || !record.source_excerpt.startsWith('【虚构演示，非浙江大学政策】') ||
      !record.answer.startsWith('【虚构演示，非学校正式规定】') || record.source_level !== 2 || record.source_url !== null ||
      record.status !== 'confirmed' || record.reviewed_by !== null || record.reviewed_at !== null || record.valid_from !== null || record.valid_until !== null ||
      record.aliases.length < 2 || record.aliases.length > 4 || record.answer.length > 180 || !record.source_excerpt ||
      excluded.test([record.question, record.answer, record.source_excerpt, ...record.aliases].join(' ')) ||
      /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|\d{3,4}[-－]\d{7,8}/i.test(record.answer + record.source_excerpt)) {
    throw new Error(`清单内容校验失败：${record.id}`);
  }
  if (records.some(other => other.id !== record.id && heading(other).some(value => heading(record).includes(value)))) throw new Error(`清单主题重复：${record.id}`);
}
const pending = [], skipped = [];
for (const record of records) {
  const sameId = existing.find(row => row.id === record.id);
  if (sameId) {
    const identical = fields.split(',').every(field => JSON.stringify(sameId[field]) === JSON.stringify(record[field]));
    if (!identical) throw new Error(`同 ID 内容冲突，保留原记录并停止：${record.id}`);
    skipped.push({ id: record.id, reason: '同批次同 ID 已存在，内容一致' });
    continue;
  }
  const duplicate = existing.find(row => heading(row).some(value => heading(record).includes(value)) ||
    normalize(row.answer).includes(normalize(record.answer)) || normalize(record.answer).includes(normalize(row.answer)));
  if (duplicate) skipped.push({ id: record.id, reason: '问题、别名或答案重复；未覆盖', existing_id: duplicate.id });
  else pending.push(record);
}
const report = {
  batch_id: manifest.batch_id, target: manifest.target, checked_at: new Date().toISOString(),
  environment: '本地评估身份配置及用户授权演示任务；未发现明确正式环境标识',
  schema_checked: Object.keys(columns), existing_count: existing.length,
  existing_topic_review: existing.length === 0 ? '真实 SELECT 为空，无既有同义主题' : '已有条目须结合清单人工核对同义主题；本批稳定 ID 不覆盖',
  excluded_topic_conflicts: existing.filter(row => excluded.test([row.question, row.answer, ...(row.aliases || [])].join(' '))).map(row => ({ id: row.id, question: row.question })),
  planned: pending.map(row => ({ id: row.id, question: row.question })), skipped,
  mode: process.argv.includes('--apply') ? 'apply' : 'readonly', inserted: [], failed: [],
};
console.log(JSON.stringify({ batch_id: report.batch_id, target: report.target, existing: existing.length, pending: pending.length, skipped, excluded_topic_conflicts: report.excluded_topic_conflicts }));
if (!process.argv.includes('--apply')) process.exit(0);
// 导入前先落盘可追踪状态；一个 PostgREST bulk INSERT 使用单一数据库事务，任何行失败整批不写入。
let prior;
try { prior = JSON.parse(await readFile(auditPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (prior?.batch_id === manifest.batch_id && prior?.target === manifest.target) report.inserted = prior.inserted || [];
await writeFile(auditPath, JSON.stringify(report, null, 2) + '\n');
if (pending.length) {
  const result = await db.from('knowledge_items').insert(pending).select(fields);
  if (result.error) {
    const actual = await allKnowledge();
    report.inserted = [...new Set([...report.inserted, ...pending.filter(row => actual.some(saved => saved.id === row.id && fields.split(',').every(field => JSON.stringify(saved[field]) === JSON.stringify(row[field])))).map(row => row.id)])];
    report.failed = pending.filter(row => !report.inserted.includes(row.id)).map(row => ({ id: row.id, code: result.error.code || 'connection_error' }));
    await writeFile(auditPath, JSON.stringify(report, null, 2) + '\n');
    throw new Error(`写入响应失败；实际存在 ${report.inserted.length} 条，本次未确认 ${report.failed.length} 条，详见审计文件。`);
  }
  report.inserted = [...new Set([...report.inserted, ...result.data.map(row => row.id)])];
  await writeFile(auditPath, JSON.stringify(report, null, 2) + '\n');
}
const verified = await checked(db.from('knowledge_items').select(fields).in('id', records.map(row => row.id)), '写入后 SELECT');
report.verified_count = verified.data.length;
report.verified = verified.data.map(row => ({ id: row.id, category_id: row.category_id, status: row.status, source_level: row.source_level, source_name: row.source_name, source_url: row.source_url, reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at, valid_from: row.valid_from, valid_until: row.valid_until }));
report.content_matches = records.filter(row => !skipped.some(skip => skip.id === row.id && skip.existing_id)).every(record =>
  verified.data.some(row => row.id === record.id && fields.split(',').every(field => JSON.stringify(row[field]) === JSON.stringify(record[field]))));
report.distribution = Object.fromEntries(categories.map(category => [category.name, verified.data.filter(row => row.category_id === category.id).length]));
await writeFile(auditPath, JSON.stringify(report, null, 2) + '\n');
if (!report.content_matches) throw new Error('真实 SELECT 与导入清单不完全一致，详见审计文件。');
console.log(JSON.stringify({ inserted_this_run: pending.length, verified_count: report.verified_count, content_matches: report.content_matches, distribution: report.distribution }));
