import type { KnowledgeItem, StudentEvent } from './types';

// 学生保存的原文作为独立来源；不改变 confirmed 知识条目的状态。
export function noticeEvidence(events: StudentEvent[]): KnowledgeItem[] {
  return events.filter(event => event.status !== 'archived').map(event => ({
    id: event.id,
    category_id: '',
    question: event.title,
    answer: event.source_text,
    source_level: 3,
    source_name: `学生保存的通知：${event.title}`,
    source_url: event.source_url,
    updated_at: event.updated_at,
    categories: null,
    source_type: 'saved_notice',
  }));
}
