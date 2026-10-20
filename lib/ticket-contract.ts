export type Ticket = {
  id: string; question: string; category_id: string | null; status: 'open' | 'answered';
  teacher_reply: string | null; reply_version: number; sedimented: boolean;
  knowledge_item_id: string | null; created_at: string; answered_at: string | null;
};
export type TicketCategory = { id: string; name: string };
export type TicketDetail = { ticket: Ticket; categories: TicketCategory[] };
export type TicketCandidate = { id: string; category_id: string; question: string; answer: string; updated_at: string };
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const replyVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
export function isTicket(value: unknown): value is Ticket {
  return record(value) && ['id', 'question', 'created_at'].every(key => typeof value[key] === 'string') &&
    ['category_id', 'teacher_reply', 'knowledge_item_id', 'answered_at'].every(key => nullableText(value[key])) &&
    (value.status === 'open' || value.status === 'answered') && typeof value.sedimented === 'boolean' && replyVersion(value.reply_version);
}
export function isTicketDetail(value: unknown): value is TicketDetail {
  return record(value) && isTicket(value.ticket) && Array.isArray(value.categories) &&
    value.categories.every(c => record(c) && typeof c.id === 'string' && typeof c.name === 'string');
}
export function isTicketCandidate(value: unknown): value is TicketCandidate {
  return record(value) && ['id', 'category_id', 'question', 'answer', 'updated_at'].every(key => typeof value[key] === 'string');
}
