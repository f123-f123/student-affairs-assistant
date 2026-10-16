import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import categories from '../lib/base-categories.json' with { type: 'json' };

nextEnv.loadEnvConfig(process.cwd());
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.DB_PROVIDER !== 'supabase' || !process.env.SUPABASE_URL || !key) throw new Error('请先配置 DB_PROVIDER=supabase 和 Supabase 服务端连接');
const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const existing = await db.from('categories').select('id,name');
if (existing.error) throw new Error(`分类读取失败：${existing.error.code}`);
const missing = categories.filter(category => !existing.data.some(row => row.id === category.id || row.name === category.name));
console.log(`基础分类：已有 ${existing.data.length}，待新增 ${missing.length}。只补分类，不写入知识、联系人、工单或对话。`);
if (process.argv.includes('--apply') && missing.length) {
  const saved = await db.from('categories').upsert(missing, { onConflict: 'id', ignoreDuplicates: true });
  if (saved.error) throw new Error(`分类初始化失败：${saved.error.code}`);
  const verified = await db.from('categories').select('id,name');
  if (verified.error || categories.some(category => !verified.data?.some(row => row.id === category.id || row.name === category.name))) throw new Error('基础分类核对失败');
  console.log(`初始化及核对完成：${verified.data.length} 个分类；原有分类未覆盖。`);
} else if (!process.argv.includes('--apply')) console.log('当前为只读预览；添加 --apply 才新增缺失分类。');
