import { NextResponse } from 'next/server';
import { safeDatabaseError } from './supabase';

export function databaseFailure(operation: string, error: unknown) {
  const cause = error as { code?: string; message?: string } | null;
  const code = cause?.code === 'PGRST205' ? 'DATABASE_TABLE_NOT_VISIBLE'
    : cause?.message === 'database_not_configured' ? 'DATABASE_CONFIG_MISSING' : 'DATABASE_UNAVAILABLE';
  console.error(`[database] ${operation}`, { upstreamCode: cause?.code ?? null, detail: safeDatabaseError(error) });
  const message = code === 'DATABASE_TABLE_NOT_VISIBLE'
    ? '业务表未出现在 Supabase public API，请检查迁移或 schema cache'
    : code === 'DATABASE_CONFIG_MISSING' ? '数据库服务端配置不完整' : '数据库暂时不可用';
  return NextResponse.json({ code, error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
