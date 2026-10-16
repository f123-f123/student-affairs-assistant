import { createClient } from '@supabase/supabase-js';
import { getLocalDb } from './local-db';

export function safeDatabaseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
  return [process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .filter((key): key is string => !!key)
    .reduce((message, key) => message.replaceAll(key, '[redacted]'), raw);
}

// 服务端专用：service role 密钥不得导入客户端组件。
export function getSupabase() {
  if (process.env.DB_PROVIDER === 'sqlite') return getLocalDb() as unknown as ReturnType<typeof createClient>;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DB_PROVIDER !== 'supabase' || !url || !key) {
    const missing = [
      ...(!url ? ['SUPABASE_URL'] : []),
      ...(!key ? ['SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'] : []),
    ];
    console.error('[database] Supabase configuration unavailable', {
      provider: process.env.DB_PROVIDER || 'unset', missing,
    });
    throw new Error('database_not_configured');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
