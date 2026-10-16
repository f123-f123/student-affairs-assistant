import type { getSupabase } from './supabase';
import { UUID_RE, isoDateTime, textField } from './validation';

export class KnowledgeInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function optionalId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new KnowledgeInputError('知识内容无效');
  return value;
}

function optionalDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = isoDateTime(value);
  if (!date) throw new KnowledgeInputError('知识内容无效');
  return date;
}

export function parseKnowledgeInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KnowledgeInputError('请求格式无效');
  const fields = value as Record<string, unknown>;
  const question = textField(fields.question, 500);
  const answer = textField(fields.answer, 4000);
  const sourceName = textField(fields.source_name, 200);
  const categoryId = optionalId(fields.category_id);
  if (!question || !answer || !sourceName || !categoryId ||
      !(fields.source_excerpt == null || typeof fields.source_excerpt === 'string') ||
      !(fields.source_url == null || typeof fields.source_url === 'string') ||
      !Array.isArray(fields.aliases) || fields.aliases.length > 20 ||
      !fields.aliases.every(alias => typeof alias === 'string' && alias.trim().length <= 100)) {
    throw new KnowledgeInputError('知识内容无效');
  }
  const sourceExcerpt = (fields.source_excerpt ?? '').trim();
  const sourceUrl = (fields.source_url ?? '').trim();
  if (sourceExcerpt.length > 10000) throw new KnowledgeInputError('知识内容无效');
  if (!sourceUrl && !sourceExcerpt) throw new KnowledgeInputError('请填写来源链接或原文依据');
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (sourceUrl.length > 2000 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new KnowledgeInputError('来源链接无效'); }
  }
  const validFrom = optionalDate(fields.valid_from);
  const validUntil = optionalDate(fields.valid_until);
  if (validFrom && validUntil && validFrom >= validUntil) throw new KnowledgeInputError('知识内容无效');
  return {
    category_id: categoryId, question, answer, source_name: sourceName,
    source_url: sourceUrl || null, source_excerpt: sourceExcerpt || null,
    aliases: [...new Set(fields.aliases.map(alias => alias.trim()).filter(Boolean))],
    valid_from: validFrom, valid_until: validUntil,
    supersedes: optionalId(fields.supersedes), origin_event_id: optionalId(fields.origin_event_id),
  };
}

export async function validateKnowledgeReferences(db: ReturnType<typeof getSupabase>, input: ReturnType<typeof parseKnowledgeInput>) {
  const category = await db.from('categories').select('id').eq('id', input.category_id).maybeSingle();
  if (category.error) throw category.error;
  if (!category.data) throw new KnowledgeInputError('类别不存在');
  if (input.origin_event_id) {
    const event = await db.from('events').select('source_text').eq('id', input.origin_event_id).maybeSingle();
    if (event.error) throw event.error;
    if (!event.data) throw new KnowledgeInputError('通知不存在');
    if (!input.source_excerpt || !event.data.source_text.includes(input.source_excerpt)) throw new KnowledgeInputError('原文依据须摘自该通知');
  }
  if (input.supersedes) {
    const previous = await db.from('knowledge_items').select('id').eq('id', input.supersedes)
      .eq('status', 'confirmed').eq('category_id', input.category_id).maybeSingle();
    if (previous.error) throw previous.error;
    if (!previous.data) throw new KnowledgeInputError('替换条目已失效或类别不一致', 409);
  }
}
