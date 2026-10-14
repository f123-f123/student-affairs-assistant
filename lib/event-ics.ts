import { createEvents, type DateArray, type EventAttributes } from 'ics';
import ICAL from 'ical.js';
import type { StudentEvent } from './types';

function dateArray(date: Date): DateArray {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()];
}

function shanghaiDayMorning(deadline: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(deadline);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 1, 0));
}

export function generateEventsIcs(items: StudentEvent[]): string {
  const withDeadline = items.filter(item => item.deadline && item.status !== 'archived');
  if (!withDeadline.length) throw new Error('没有可导出的截止事项');
  const events: EventAttributes[] = withDeadline.map(item => {
    const deadline = new Date(item.deadline!);
    const materials = item.materials.map(material => `${material.done ? '☑' : '☐'} ${material.name}`).join('\n');
    const description = [item.summary, item.eligibility && `适用对象：${item.eligibility}`, item.submit_to && `提交方式：${item.submit_to}`,
      materials && `材料清单：\n${materials}`, item.source_url && `原通知：${item.source_url}`].filter(Boolean).join('\n');
    return {
      uid: `event-${item.id}@student-affairs.local`,
      sequence: Math.floor(new Date(item.updated_at).getTime() / 1000),
      lastModified: new Date(item.updated_at).getTime(),
      start: dateArray(deadline), startInputType: 'utc', startOutputType: 'utc', duration: { minutes: 1 },
      title: item.title, description, url: item.source_url || undefined,
      alarms: [
        { action: 'display', description: `${item.title}：距截止还有3天`, trigger: { days: 3, before: true } },
        { action: 'display', description: `${item.title}：距截止还有1天`, trigger: { days: 1, before: true } },
        { action: 'display', description: `${item.title}：今天截止`, trigger: shanghaiDayMorning(deadline).getTime() },
      ],
    };
  });
  const { error, value } = createEvents(events, { productId: 'Student Affairs Assistant', calName: '学生事务日程' });
  if (error || !value) throw new Error('日历文件生成失败');
  // 用独立解析库回读，验证 VEVENT、UID 和提醒数量。
  const calendar = new ICAL.Component(ICAL.parse(value));
  const parsed = calendar.getAllSubcomponents('vevent');
  if (parsed.length !== events.length || parsed.some((event, index) =>
    event.getFirstPropertyValue('uid') !== events[index].uid || event.getAllSubcomponents('valarm').length !== 3)) {
    throw new Error('日历文件校验失败');
  }
  return value;
}
