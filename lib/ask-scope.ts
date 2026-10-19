import type { AskResponse, KnowledgeItem } from './types';
import { assessKnowledgeScope, describeScope, scopeFieldNames } from './knowledge-scope';

export function scopeReply(question: string, topic: AskResponse['topic_context'] | null, items: KnowledgeItem[]) {
  if (!topic?.scope_candidates?.length) return null;
  const compact = question.trim().replace(/[。！!？?\s]/g, '');
  const number = /^(?:确认|选择|就|是)?第?([1-3一二三])(?:个|项|条)?$/.exec(compact)?.[1];
  const yes = /^(?:是|是的|对|对的|没错|确认|就是这个|就是这一项|就是这项)$/.test(compact);
  if (number || yes) {
    const index = number ? (/\d/.test(number) ? Number(number) - 1 : '一二三'.indexOf(number)) : topic.scope_candidates.length === 1 ? 0 : -1;
    const choice = topic.scope_candidates[index];
    const current = choice && items.find(item => item.id === choice.id && (item.version ?? 1) === choice.version && (!item.status || item.status === 'confirmed'));
    if (current) return { query: `${topic.question}；咨询范围：${describeScope(current)}`, accepted: true };
    return { query: topic.question, accepted: false };
  }
  if (/^(?:我是|我在|来自|就读于|属于|20\d{2}(?:级|年度|[-—–至]20\d{2}学年)|[\p{Script=Han}]{1,16}(?:学院|学园))/u.test(compact) && !/奖学金|二奖|三奖|宿舍|请假|证明|实习/.test(compact)) {
    let base = topic.question;
    for (const pattern of [/[\p{Script=Han}]{1,24}(?:学院|学园)/gu, /20\d{2}级/g, /20\d{2}[-—–至]20\d{2}学年|20\d{2}年度/g]) {
      pattern.lastIndex = 0; if (pattern.test(question)) base = base.replace(pattern, '');
    }
    return { query: `${base}；补充范围：${question}`, accepted: false };
  }
  return null;
}

export function scopeClarification(items: KnowledgeItem[], question: string): Pick<AskResponse, 'notice' | 'scope_candidates'> {
  const seen = new Set<string>();
  const choices = items.filter(item => {
    const key = JSON.stringify([describeScope(item), item.source_url, item.source_name]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 3).map(item => ({ id: item.id, version: item.version ?? 1, label: describeScope(item),
    missing_fields: assessKnowledgeScope(question, item).missing.map(field => scopeFieldNames[field]), source_name: item.source_name, source_url: item.source_url }));
  const notice = choices.length === 1 ? `找到${choices[0].label}通知，你咨询的是这一项吗？请确认通知范围，或补充${choices[0].missing_fields.join('、')}。这不代表已认定你符合申请条件。`
    : `找到以下相关通知，请选择你咨询的一项，或补充学院/学园、年级、年度及项目：\n${choices.map((choice, i) => `${i + 1}. ${choice.label}`).join('\n')}\n尚未认定你符合任一通知的申请条件。`;
  return { notice, scope_candidates: choices };
}
