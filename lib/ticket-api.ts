import { NextResponse } from 'next/server';
import { noStore } from './teacher-api';

export const ticketError = (code: string, error: string, status = 503) => NextResponse.json({ code, error }, { status, headers: noStore });
export const ticketConflict = (error = '回复版本已变化，当前输入已保留，请读取最新回复并对照') => ticketError('REPLY_VERSION_CONFLICT', error, 409);
export function ticketDatabaseError(error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  // 仅数据库明确报告相关对象缺失才建议迁移；不向客户端返回数据库原文。
  if (['42703', 'PGRST204'].includes(e?.code || '') && /reply_version/.test(e?.message || ''))
    return ticketError('TICKET_VERSION_COLUMN_MISSING', '数据库缺少回复版本字段，请部署 migration_official_knowledge_import.sql');
  if (['42883', 'PGRST202'].includes(e?.code || '') && /confirm_ticket_knowledge_public_checked/.test(e?.message || ''))
    return ticketError('TICKET_PUBLIC_RPC_MISSING', '数据库缺少安全入库函数，请部署 migration_ticket_public_evidence.sql');
  return ticketError('TICKET_DATABASE_UNAVAILABLE', '工单数据库暂时不可用，请稍后重试');
}
export const ticketResponseError = () => ticketError('TICKET_RESPONSE_INVALID', '工单响应结构异常，请重试或联系管理员检查接口版本');
