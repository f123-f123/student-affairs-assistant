import type { EventDraft, EventMaterial, PublicationDateCandidate } from './types';
import { analyzeNoticeDeadline } from './event-date';
import { noticeAudience } from './notice-scope';

export function parseEventExtraction(raw: string, sourceText: string, publishDate: string | null, sourceUrl: string | null, candidates: PublicationDateCandidate[] = []): EventDraft {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown;
  try { data = JSON.parse(cleaned); } catch { throw new Error('invalid_extraction'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_extraction');
  const fields = data as Record<string, unknown>;
  if (typeof fields.title !== 'string' || typeof fields.summary !== 'string' || typeof fields.eligibility !== 'string' ||
      typeof fields.submit_to !== 'string' || !(fields.deadline === null || typeof fields.deadline === 'string') ||
      !(fields.deadline_source_text === null || typeof fields.deadline_source_text === 'string') ||
      !Array.isArray(fields.materials)) throw new Error('invalid_extraction');
  // 原文只有通知片段时，允许老师或学生在界面补标题，不把空标题当服务故障。
  const title = fields.title.trim() || '请补充事项标题';
  if (title.length > 300) throw new Error('invalid_extraction');
  const materials: EventMaterial[] = fields.materials.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_extraction');
    const material = item as Record<string, unknown>;
    if (typeof material.name !== 'string' || typeof material.source_text !== 'string') throw new Error('invalid_extraction');
    return { name: material.name.trim(), source_text: material.source_text.trim(), done: false };
  }).filter(item => item.name);
  const evidence = fields.deadline_source_text?.trim() || null;
  const resolved = analyzeNoticeDeadline(sourceText, evidence, publishDate, candidates);
  const audience = noticeAudience(sourceText);
  const eligibility = fields.eligibility.trim();
  return {
    title, summary: fields.summary.trim(), eligibility: audience && !eligibility.includes(audience.replace(/^各位/, '')) ? `${audience}。${eligibility}` : eligibility, submit_to: fields.submit_to.trim(),
    deadline: resolved.deadline, deadline_source_text: resolved.evidence, deadline_inferred: resolved.inferred,
    materials, source_url: sourceUrl, source_text: sourceText, publish_date: resolved.publishDate, date_context: resolved.context,
  };
}
