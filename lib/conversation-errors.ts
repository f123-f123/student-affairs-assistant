export type ConversationErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'DATABASE_CONFIG_MISSING' | 'DATABASE_TABLE_NOT_VISIBLE' | 'DATABASE_UNAVAILABLE' | 'INVALID_INPUT' | 'NETWORK_ERROR';

export function conversationError(status: number, code: ConversationErrorCode) {
  const messages: Record<ConversationErrorCode, string> = {
    UNAUTHENTICATED: '登录已过期，请重新登录',
    FORBIDDEN: '没有访问权限',
    NOT_FOUND: '对话不存在或已不可访问',
    DATABASE_CONFIG_MISSING: '数据库未配置完成，请在服务端补齐 Supabase 服务密钥',
    DATABASE_TABLE_NOT_VISIBLE: 'Supabase 中未找到业务表，请检查迁移或 schema cache',
    DATABASE_UNAVAILABLE: '数据库暂时不可用，请联系管理员检查服务端配置',
    INVALID_INPUT: '请求内容无效',
    NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  };
  return { status, code, message: messages[code] };
}

export async function readConversationError(response: Response) {
  const body = await response.json().catch(() => null) as { code?: string } | null;
  const code = body?.code;
  if (code === 'UNAUTHENTICATED' || response.status === 401) return conversationError(401, 'UNAUTHENTICATED');
  if (code === 'FORBIDDEN' || response.status === 403) return conversationError(403, 'FORBIDDEN');
  if (code === 'NOT_FOUND' || response.status === 404) return conversationError(404, 'NOT_FOUND');
  if (code === 'INVALID_INPUT' || response.status === 400) return conversationError(400, 'INVALID_INPUT');
  if (code === 'DATABASE_CONFIG_MISSING') return conversationError(503, 'DATABASE_CONFIG_MISSING');
  if (code === 'DATABASE_TABLE_NOT_VISIBLE') return conversationError(503, 'DATABASE_TABLE_NOT_VISIBLE');
  return conversationError(response.status, 'DATABASE_UNAVAILABLE');
}
