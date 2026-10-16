import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd());

const provider = process.env.DB_PROVIDER;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (provider !== 'supabase') {
  console.error('配置诊断：DB_PROVIDER 必须显式设为 supabase；当前未执行远端检查。');
  process.exitCode = 1;
} else if (!url || !key) {
  const missing = [...(!url ? ['SUPABASE_URL'] : []), ...(!key ? ['SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY'] : [])];
  console.error(`配置诊断：服务端缺少 ${missing.join('、')}。请补齐后重新运行；未连接远端，也未修改数据。`);
  process.exitCode = 1;
} else {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`目标项目：${new URL(url).hostname}（请与 Supabase Dashboard 项目标识核对）`);
  const openapi = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', Accept: 'application/openapi+json' },
  });
  const specification = await openapi.json().catch(() => ({}));
  const exposed = Object.keys(specification.paths ?? {}).filter(path => path !== '/');
  console.log(`public REST 暴露：HTTP ${openapi.status}，业务路径 ${exposed.length} 个`);
  const checks = [
    ['conversations', 'id,title,device_id,created_at,updated_at'],
    ['chat_logs', 'id,device_id,conversation_id,question,response_json,error_type,created_at'],
    ['categories', 'id,name,description,sort_order'],
    ['knowledge_items', 'id,category_id,question,answer,aliases,source_level,source_name,source_url,source_excerpt,valid_from,valid_until,version,updated_at,status'],
    ['contacts', 'id,category_id,name,role,phone,email,office,office_hours'],
    ['tickets', 'id,device_id,question,category_id,status,teacher_reply,sedimented,created_at'],
    ['events', 'id,device_id,title,deadline,status,source_article_id,created_at'],
    ['teacher_login_attempts', 'key,attempts,window_start'],
    ['information_sources', 'id,owner_id,name,url,kind,last_checked_at'],
    ['source_links', 'id,source_id,owner_id,url,title'],
    ['source_articles', 'id,source_id,owner_id,url,title,content_hash'],
    ['source_article_versions', 'id,article_id,owner_id,revision,content_hash'],
  ];
  for (const [table, columns] of checks) {
    const { data, error, status } = await db.from(table).select(columns).limit(1);
    const detail = error ? `${error.code || 'query_failed'} ${error.message}` : `可读取，样本 ${data.length} 行`;
    console.log(`${table}: HTTP ${status} ${detail.replaceAll(key, '[redacted]')}`);
    if (error) process.exitCode = 1;
  }
  console.log(process.exitCode
    ? '真实 GET 检查未全部通过；若为 PGRST205，请用 supabase/diagnose_public.sql 核对物理表。未执行迁移或写入。'
    : '全部业务表及字段的真实 GET 已通过；未执行迁移或写入。');
}
