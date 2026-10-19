import { describe, expect, it } from 'vitest';
import { displayAnswer } from '../lib/answer-display';
import { parseDisplayDate, displayDate } from '../lib/date-only';

describe('回答分行兼容', () => {
  it('五个连续步骤逐行，保留小数、日期、版本和链接', () => {
    const text = '办理如下：1. 先核对 v2.1。2. 填写数值 3.5。3. 查看 2026.10.19。4. 打开 https://example.org/v2.1?a=3.5。5. 提交。';
    const lines = displayAnswer(text).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain('1. 先核对 v2.1'); expect(lines[2]).toContain('3.5'); expect(lines[3]).toContain('2026.10.19');
    expect(lines[4]).toContain('https://example.org/v2.1?a=3.5'); expect(lines[5]).toBe('5. 提交。');
  });
  it.each(['日期 2026.10.19，数值 3.5，版本 v2.1，https://example.org/a', '1. 一步。3. 三步。5. 五步。', '步骤：\n1. 准备\n2. 提交'])('不拆不可靠或已有换行的内容：%s', text => expect(displayAnswer(text)).toBe(text));
});
describe('纯日期，无时区转换', () => {
  it.each(['2024/02/29', '2000/02/29', '2026/10/19'])('合法日期 %s', value => { expect(parseDisplayDate(value)).toBe(value.replaceAll('/', '-')); expect(displayDate(value.replaceAll('/', '-'))).toBe(value); });
  it.each(['2026/02/29', '1900/02/29', '2026/04/31', '2026/13/01', '0000/01/01', '2026/2/03', '2026-10-19', ''])('拒绝非法或错误格式 %s', value => expect(parseDisplayDate(value)).toBeNull());
  it('未知日期显示未知', () => { expect(displayDate(null)).toBe('未知'); expect(displayDate('2026-02-30')).toBe('未知'); });
});
