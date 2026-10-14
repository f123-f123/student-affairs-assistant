import { describe, expect, it } from 'vitest';
import { resolveDeadline } from '../lib/event-date';
import { parseEventExtraction } from '../lib/event-extraction';

describe('通知日期依据', () => {
  it('原文不存在的日期句子会丢弃', () => {
    expect(resolveDeadline('请关注后续通知。', '截止2026年10月20日。', '2026-10-13').deadline).toBeNull();
  });
  it('绝对日期按上海时间，缺时分默认23:59', () => {
    expect(resolveDeadline('请于2026年10月20日前提交。', '请于2026年10月20日前提交。', '2026-10-13'))
      .toEqual({ deadline: '2026-10-20T15:59:00.000Z', inferred: false, evidence: '请于2026年10月20日前提交。' });
  });
  it('本周五和下月10日依据发布日期推算并标待确认', () => {
    expect(resolveDeadline('本周五前提交。', '本周五前提交。', '2026-10-13').deadline).toBe('2026-10-16T15:59:00.000Z');
    expect(resolveDeadline('下月10日前提交。', '下月10日前提交。', '2026-10-13'))
      .toEqual({ deadline: '2026-11-10T15:59:00.000Z', inferred: true, evidence: '下月10日前提交。' });
  });
  it('材料依据不在原文中时保留供界面标记', () => {
    const text = '申请奖学金请于2026年10月20日前提交申请表。';
    const raw = JSON.stringify({ title: '奖学金申请', summary: '', eligibility: '', deadline: '2026-10-20', deadline_source_text: '请于2026年10月20日前提交申请表。', submit_to: '', materials: [{ name: '成绩单', source_text: '请提交成绩单。' }] });
    const result = parseEventExtraction(raw, text, '2026-10-13', null);
    expect(result.materials[0].source_text).toBe('请提交成绩单。');
    expect(text.includes(result.materials[0].source_text)).toBe(false);
  });
  it('同一句有多个日期时不猜截止日', () => {
    const sentence = '评审于2026年10月15日开始，2026年10月20日结束。';
    expect(resolveDeadline(sentence, sentence, '2026-10-13').deadline).toBeNull();
  });
  it('原文时间被截断时不猜截止时刻', () => {
    const sentence = '个人申请截止时间：10月18日（周日）17：3';
    expect(resolveDeadline(sentence, sentence, '2026-10-13')).toEqual({ deadline: null, inferred: false, evidence: sentence });
  });
  it('通知片段没有标题时仍能提取并交给学生补标题', () => {
    const sentence = '个人申请截止时间：10月18日（周日）17：3';
    const raw = JSON.stringify({ title: '', summary: '', eligibility: '', deadline: '2026-10-18T17:30:00', deadline_source_text: sentence, submit_to: '', materials: [] });
    const result = parseEventExtraction(raw, sentence, '2026-10-13', null);
    expect(result.title).toBe('请补充事项标题');
    expect(result.deadline).toBeNull();
    expect(result.deadline_source_text).toBe(sentence);
  });
});
