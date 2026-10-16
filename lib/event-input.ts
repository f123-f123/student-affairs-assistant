import type { EventDraft, EventMaterial } from './types';
import { isDateOnly, isoDateTime } from './validation';

export function parseEventMaterials(value: unknown): EventMaterial[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('材料内容无效');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 ||
        typeof item.done !== 'boolean' || typeof item.source_text !== 'string' || item.source_text.length > 1000) throw new Error('材料内容无效');
    return { name: item.name.trim(), done: item.done, source_text: item.source_text.trim() };
  });
}

export function parseEventInput(value: unknown): EventDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('事项内容无效');
  const data = value as Record<string, unknown>;
  const required = ['title', 'summary', 'eligibility', 'submit_to', 'source_text'];
  if (required.some(key => typeof data[key] !== 'string') ||
      typeof data.title !== 'string' || !data.title.trim() || data.title.length > 300 ||
      typeof data.source_text !== 'string' || !data.source_text.trim() || data.source_text.length > 20000 ||
      (data.summary as string).length > 4000 || (data.eligibility as string).length > 4000 || (data.submit_to as string).length > 4000 ||
      !(data.deadline === null || typeof data.deadline === 'string') ||
      !(data.deadline_source_text === null || typeof data.deadline_source_text === 'string') ||
      typeof data.deadline_inferred !== 'boolean' ||
      !(data.source_url === null || typeof data.source_url === 'string') ||
      !(data.publish_date === null || typeof data.publish_date === 'string')) throw new Error('事项内容无效');
  const materials = parseEventMaterials(data.materials);
  if (data.deadline && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(data.deadline)) throw new Error('截止时间无效');
  const deadline = data.deadline ? isoDateTime(data.deadline) : null;
  if (data.deadline && !deadline) throw new Error('截止时间无效');
  if (deadline && (!data.deadline_source_text || !(data.source_text as string).includes(data.deadline_source_text))) throw new Error('截止时间缺少原文依据');
  if (data.source_url) {
    try { const parsed = new URL(data.source_url); if (!['http:', 'https:'].includes(parsed.protocol) || data.source_url.length > 2000) throw new Error(); }
    catch { throw new Error('原链接无效'); }
  }
  if (data.publish_date && !isDateOnly(data.publish_date)) throw new Error('发布日期无效');
  return {
    title: data.title.trim(), summary: (data.summary as string).trim(), eligibility: (data.eligibility as string).trim(),
    deadline, deadline_source_text: data.deadline_source_text?.trim() || null,
    deadline_inferred: data.deadline_inferred, submit_to: (data.submit_to as string).trim(), materials,
    source_url: data.source_url || null, source_text: data.source_text.trim(), publish_date: data.publish_date || null,
  } as EventDraft;
}
