import { describe, expect, it } from 'vitest';
import { resolveDeadline } from '../lib/event-date';

describe('通知日期解析', () => {
  const resolve = (sentence: string, published = '2026-10-15') => resolveDeadline(sentence, sentence, published);
  it('正确处理上午、下午和晚上时刻', () => {
    expect(resolve('2026年10月20日上午9:00截止').deadline).toBe('2026-10-20T01:00:00.000Z');
    expect(resolve('2026年10月20日下午3:00截止').deadline).toBe('2026-10-20T07:00:00.000Z');
    expect(resolve('2026年10月20日晚上8点半截止').deadline).toBe('2026-10-20T12:30:00.000Z');
    expect(resolve('2026年10月20日17时前')).toMatchObject({ deadline: '2026-10-20T09:00:00.000Z', inferred: false });
    expect(resolve('2026年10月20日17点30分截止').deadline).toBe('2026-10-20T09:30:00.000Z');
    expect(resolve('2026年10月20日下午3时截止').deadline).toBe('2026-10-20T07:00:00.000Z');
  });
  it('日期无时刻需确认，无法识别的时刻不补成23:59', () => {
    expect(resolve('2026年10月20日截止').inferred).toBe(true);
    expect(resolve('2026年10月20日下午截止').deadline).toBeNull();
    expect(resolve('2026年10月20日17:3截止').deadline).toBeNull();
    expect(resolve('2026年10月20日十七时前').deadline).toBeNull();
    expect(resolve('2026年10月20日17点一刻截止').deadline).toBeNull();
  });
  it('下周日与下周天相同，跨月日期正确', () => {
    expect(resolve('下周日截止', '2026-10-30').deadline).toBe(resolve('下周天截止', '2026-10-30').deadline);
    expect(resolve('下周天截止', '2026-10-30').deadline).toBe('2026-11-08T15:59:00.000Z');
    expect(resolve('下月2日截止', '2026-12-28').deadline).toBe('2027-01-02T15:59:00.000Z');
  });
  it('发布时间未知时不推算相对日期，但保留完整的绝对日期', () => {
    expect(resolveDeadline('下周日截止', '下周日截止', null).deadline).toBeNull();
    expect(resolveDeadline('2026年11月2日截止', '2026年11月2日截止', null).deadline).toBe('2026-11-02T15:59:00.000Z');
  });
});
