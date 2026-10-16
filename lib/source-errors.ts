import { NextResponse } from 'next/server';
import { FETCH_FAILURE, FETCH_TOO_LONG, FETCH_UNSUPPORTED, NoticeFetchError } from './fetch-errors';
import { noStore } from './teacher-api';

export function sourceError(cause: unknown) {
  if (cause instanceof NoticeFetchError) return { message: cause.message, status: cause.status, code: cause.code, stage: cause.stage, details: cause.details };
  if (attachmentSchemaMissing(cause)) return { message: '信息源数据库尚未升级，请先执行 migration_notice_attachments.sql', status: 503, code: 'SOURCE_SCHEMA_MIGRATION_REQUIRED', stage: 'storage' };
  return cause instanceof Error && [FETCH_FAILURE, FETCH_TOO_LONG, FETCH_UNSUPPORTED].includes(cause.message)
    ? { message: cause.message, status: 422, code: 'FETCH_FAILED' } : { message: '服务暂时不可用', status: 503 };
}

export function attachmentSchemaMissing(cause: unknown): boolean {
  const error = cause as { code?: string; message?: string } | null;
  return !!error && ['42703', 'PGRST202', 'PGRST204'].includes(error.code ?? '') && /attachments|save_source_article/.test(error.message ?? '');
}

export function sourceFailure(cause: unknown) {
  const { message, status, ...details } = sourceError(cause);
  return NextResponse.json({ error: message, ...details }, { status, headers: noStore });
}
