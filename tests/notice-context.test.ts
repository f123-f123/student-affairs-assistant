import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeNoticeDeadline, reparseDraftDates, shanghaiDateTime } from '../lib/event-date';
import { signatureDates, publicationDates } from '../lib/notice-dates';
import { noticeContactCandidates } from '../lib/notice-contacts';
import { parseEventExtraction } from '../lib/event-extraction';
import { parseEventInput } from '../lib/event-input';
import { parseNoticeHtml } from '../lib/safe-fetch';

const evidence = '个人申请截止时间：10月18日（周日）17：30';
const source = `依据2017年1月2日制定的文件办理。${evidence}。王老师 邮箱：notice@example.org。求是学院紫云碧峰学园奖学金评审委员会2026年10月13日`;
const raw = JSON.stringify({ title: '奖学金申请', summary: '', eligibility: '', submit_to: '', deadline: null, deadline_source_text: evidence, materials: [] });
afterEach(() => { vi.useRealTimers(); });

describe('通知落款和完整截止依据', () => {
  it('使用文末落款年份补全本例，不用电脑当前年份，保留原文依据', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    const draft = parseEventExtraction(raw, source, null, null);
    expect(draft.publish_date).toBe('2026-10-13'); expect(draft.deadline).toBe('2026-10-18T09:30:00.000Z');
    expect(shanghaiDateTime(draft.deadline!)).toBe('2026/10/18 17:30'); expect(draft.deadline_inferred).toBe(true);
    expect(draft.date_context).toMatchObject({ basis: 'signature', state: 'resolved', mode: 'parsed' });
    expect(draft.date_context!.candidates).toHaveLength(1); expect(source).toContain(draft.date_context!.candidates[0].evidence);
    expect(parseEventInput(draft).date_context).toEqual(draft.date_context);
  });
  it('没有落款不取正文第一个日期；区分没有日期、年份未知和时间不完整', () => {
    expect(signatureDates('根据2026年10月13日的文件，需核对原通知。')).toEqual([]);
    expect(analyzeNoticeDeadline(evidence, evidence, null).context.state).toBe('year_required');
    expect(analyzeNoticeDeadline('请关注后续通知。', null, null).context.state).toBe('none');
    const incomplete = '截止时间：10月18日17：3';
    expect(analyzeNoticeDeadline(incomplete, incomplete, '2026-10-13').context.state).toBe('invalid');
  });
  it('网页日期与正文落款冲突时不猜，用户明确选择后才解析；星期不符也提示冲突', () => {
    const page = [{ date: '2025-10-13', kind: 'page' as const, evidence: '网页时间2025-10-13' }];
    const result = analyzeNoticeDeadline(source, evidence, null, page);
    expect(result.deadline).toBeNull(); expect(result.context.state).toBe('conflict'); expect(result.context.candidates).toHaveLength(2);
    expect(analyzeNoticeDeadline(source, evidence, '2026-10-13', page).deadline).toBe('2026-10-18T09:30:00.000Z');
    const wrong = evidence.replace('周日', '周一');
    expect(analyzeNoticeDeadline(wrong, wrong, '2026-10-13').context.state).toBe('conflict');
  });
  it('真实网页解析保留元数据和落款候选，不任选第一个', () => {
    const html = `<html><head><title>通知</title><meta property="article:published_time" content="2025-10-13T10:00:00Z"></head><body><article><h1>通知</h1><p>${source}</p></article></body></html>`;
    const result = parseNoticeHtml(html, 'https://example.org/notice');
    expect(result.publishedDate).toBeNull(); expect(result.dateCandidates.map(candidate => candidate.kind)).toEqual(['page', 'signature']);
    expect(publicationDates(source).map(candidate => candidate.date)).toEqual(['2026-10-13']);
  });
  it('修改发布日期或依据重新解析；手动截止不会被静默覆盖，可明确采用建议', () => {
    const text = source.replace('（周日）', '');
    const draft = parseEventExtraction(raw.replace('（周日）', ''), text, null, null);
    const changed = reparseDraftDates(draft, { publish_date: '2027-10-13' });
    expect(changed.deadline).toBe('2027-10-18T09:30:00.000Z');
    const manual = { ...draft, deadline: '2026-10-18T10:00:00.000Z', date_context: { ...draft.date_context!, mode: 'manual' as const } };
    const protectedDraft = reparseDraftDates(manual, { publish_date: '2027-10-13' });
    expect(protectedDraft.deadline).toBe(manual.deadline); expect(protectedDraft.date_context!.suggested_deadline).toBe('2027-10-18T09:30:00.000Z');
    expect(reparseDraftDates(protectedDraft, {}, true).deadline).toBe('2027-10-18T09:30:00.000Z');
    expect(reparseDraftDates(draft, { deadline_source_text: '不在原文中' }).deadline).toBeNull();
    expect(reparseDraftDates(draft, { deadline_source_text: '不在原文中' }).deadline_source_text).toBe('不在原文中');
    const unknown = reparseDraftDates(draft, { publish_date: null });
    expect(unknown.publish_date).toBeNull(); expect(unknown.date_context!.state).toBe('year_required');
  });
  it('伪造的正文落款依据不能保存', () => {
    const draft = parseEventExtraction(raw, source, null, null);
    expect(() => parseEventInput({ ...draft, date_context: { ...draft.date_context, candidates: [{ date: '2026-10-13', kind: 'signature', evidence: '伪造落款' }] } })).toThrow('日期依据须与原文一致');
  });
});

describe('通知联系人候选只来自代码匹配', () => {
  it('原文姓名邮箱和附近电话带依据，绝不补写缺失字段', () => {
    expect(noticeContactCandidates(source)).toEqual([{ name: '王老师', role: 'teacher', email: 'notice@example.org', phone: null, source_excerpt: '王老师 邮箱：notice@example.org' }]);
    const text = '联系人：王老师，邮箱：notice@example.org，电话：0571-12345678。';
    const candidates = noticeContactCandidates(text);
    expect(candidates).toHaveLength(1); expect(candidates[0]).toMatchObject({ name: '王老师', email: 'notice@example.org', phone: '0571-12345678' });
    expect(text).toContain(candidates[0].source_excerpt);
    expect(noticeContactCandidates('没有写联系人，材料交给指定部门。')).toEqual([]);
    expect(noticeContactCandidates('邮箱：notice@example.org')[0]).toMatchObject({ name: '', role: null, phone: null });
  });
});
