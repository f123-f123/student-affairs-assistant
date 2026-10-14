import { createClient } from '@supabase/supabase-js';
import { getLocalDb } from './local-db';

// 服务端专用：service role 密钥不得导入客户端组件。
export function getSupabase() {
  if (process.env.DB_PROVIDER === 'sqlite') return getLocalDb() as unknown as ReturnType<typeof createClient>;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('database_not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
