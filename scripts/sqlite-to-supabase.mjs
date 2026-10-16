import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'node:path';

const apply = process.argv.includes('--apply');
const sqliteArg = process.argv.find(arg => arg.startsWith('--sqlite='));
if (!sqliteArg) throw new Error('用法: node scripts/sqlite-to-supabase.mjs --sqlite=路径 [--apply]');
const path = resolve(sqliteArg.slice('--sqlite='.length));
const tables = [
  'categories', 'contacts', 'knowledge_items', 'knowledge_item_versions',
  'tickets', 'conversations', 'chat_logs', 'information_sources', 'source_links',
  'source_articles', 'source_article_versions', 'events',
];
const jsonColumns = new Set(['aliases', 'snapshot', 'cited_item_ids', 'materials', 'response_json', 'attachments']);
const boolColumns = new Set(['sedimented', 'answerable', 'deadline_inferred']);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (apply && (!url || !key)) throw new Error('--apply 需要 SUPABASE_URL 和 SUPABASE_SECRET_KEY（或旧版 SUPABASE_SERVICE_ROLE_KEY）');
const target = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const source = new DatabaseSync(path, { readOnly: true });

async function existingCount(table, rows) {
  let count = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    if (table === 'knowledge_item_versions') {
      for (const row of chunk) {
        const { data, error } = await target.from(table).select('item_id').eq('item_id', row.item_id).eq('version', row.version).maybeSingle();
        if (error) throw error;
        if (data) count++;
      }
    } else {
      const { data, error } = await target.from(table).select('id').in('id', chunk.map(row => row.id));
      if (error) throw error;
      count += data.length;
    }
  }
  return count;
}

try {
  for (const table of tables) {
    const present = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!present) { console.log(`${table}: 源表不存在，跳过`); continue; }
    const rows = source.prepare(`SELECT * FROM "${table}"`).all();
    if (table === 'knowledge_items') {
      const byId = new Map(rows.map(row => [row.id, row]));
      const depth = (row, seen = new Set()) => {
        if (!row.supersedes || !byId.has(row.supersedes)) return 0;
        if (seen.has(row.id)) throw new Error('knowledge_items: 替换关系成环');
        return 1 + depth(byId.get(row.supersedes), new Set([...seen, row.id]));
      };
      rows.sort((a, b) => depth(a) - depth(b));
    }
    const ids = rows.map(row => table === 'knowledge_item_versions' ? `${row.item_id}:${row.version}` : row.id);
    if (new Set(ids).size !== ids.length) throw new Error(`${table}: 源主键重复`);
    const existing = target ? await existingCount(table, rows) : 0;
    console.log(`${table}: 源 ${rows.length} / 目标已存在 ${target ? existing : '未连接'} / 待导入 ${target ? rows.length - existing : '未核对'}`);
    if (!apply || rows.length === 0) continue;
    const converted = rows.map(row => {
      const value = Object.fromEntries(Object.entries(row).map(([column, raw]) => [column,
        raw == null ? null : jsonColumns.has(column) ? JSON.parse(raw) : boolColumns.has(column) ? !!raw : raw,
      ]));
      if (table === 'knowledge_items' && value.status === 'confirmed' && !value.reviewed_at) value.reviewed_at = value.updated_at;
      return value;
    });
    for (let offset = 0; offset < converted.length; offset += 100) {
      const { error } = await target.from(table).upsert(converted.slice(offset, offset + 100), {
        onConflict: table === 'knowledge_item_versions' ? 'item_id,version' : 'id', ignoreDuplicates: true,
      });
      if (error) throw error;
    }
    const verified = await existingCount(table, rows);
    if (verified !== rows.length) throw new Error(`${table}: 数量核对失败 ${verified}/${rows.length}`);
    console.log(`${table}: 已核对 ${verified}/${rows.length} 个原 ID`);
  }
} finally { source.close(); }
