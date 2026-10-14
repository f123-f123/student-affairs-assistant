export type Draft = { question: string; answer: string };

function removeIdentifiers(text: string): string {
  return text.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[电话已移除]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已移除]')
    .replace(/(?<!\d)\d{8,20}(?!\d)/g, '[编号已移除]');
}

export function parseDraft(raw: string): Draft {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('invalid_draft');
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new Error('invalid_draft'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_draft');
  const value = parsed as Record<string, unknown>;
  if (typeof value.question !== 'string' || typeof value.answer !== 'string') throw new Error('invalid_draft');
  // 常见数字身份标识直接移除；姓名及上下文仍由老师人工核对。
  const question = removeIdentifiers(value.question.trim());
  const answer = removeIdentifiers(value.answer.trim());
  if (!question || !answer || question.length > 500 || answer.length > 4000) throw new Error('invalid_draft');
  return { question, answer };
}
