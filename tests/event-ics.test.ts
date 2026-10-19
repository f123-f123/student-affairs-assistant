import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { generateEventsIcs } from '../lib/event-ics';
import type { StudentEvent } from '../lib/types';

const item: StudentEvent = {
  id: '30000000-0000-4000-8000-000000000001', device_id: '10000000-0000-4000-8000-000000000001',
  title: '奖学金申请', summary: '请按时提交', eligibility: '二年级以上', deadline: '2026-10-20T15:59:00.000Z',
  deadline_source_text: '10月20日前提交', deadline_inferred: false, submit_to: '学生中心',
  materials: [{ name: '申请表', done: false, source_text: '提交申请表' }], source_url: 'https://example.edu/notice',
  source_text: '申请通知', publish_date: '2026-10-13', status: 'active', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
};

describe('ICS 导出', () => {
  it('生成并回读 VEVENT、稳定 UID 和三条提醒', () => {
    const file = generateEventsIcs([item]);
    const calendar = new ICAL.Component(ICAL.parse(file));
    expect(calendar.getFirstPropertyValue('prodid')).toBe('校园办事猿');
    expect(file).toContain('校园办事猿日程');
    const event = calendar.getFirstSubcomponent('vevent')!;
    expect(event.getFirstPropertyValue('uid')).toBe(`event-${item.id}@student-affairs.local`);
    expect(event.getAllSubcomponents('valarm')).toHaveLength(3);
    expect(file).toContain('TRIGGER:-P3DT');
    expect(file).toContain('TRIGGER:-P1DT');
    expect(file).toContain('TRIGGER;VALUE=DATE-TIME:20261020T010000Z');
    expect(event.getFirstPropertyValue('description')).toContain('申请表');
    expect(event.getFirstPropertyValue('description')).toContain(item.source_url);
    expect(generateEventsIcs([item])).toContain(`UID:event-${item.id}@student-affairs.local`);
  });
  it('没有截止时间的事项不导出', () => {
    expect(() => generateEventsIcs([{ ...item, deadline: null }])).toThrow('没有可导出的截止事项');
    expect(() => generateEventsIcs([{ ...item, status: 'done' }])).toThrow('没有可导出的截止事项');
  });
  it('早于当天九点截止时不生成晚于截止的提醒', () => {
    const file = generateEventsIcs([{ ...item, deadline: '2026-10-20T00:00:00.000Z' }]);
    const event = new ICAL.Component(ICAL.parse(file)).getFirstSubcomponent('vevent')!;
    expect(event.getAllSubcomponents('valarm')).toHaveLength(2);
  });
});
