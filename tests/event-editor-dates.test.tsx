// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventEditor from '../app/components/EventEditor';
import EventContacts from '../app/components/EventContacts';
import { parseDisplayDateTime } from '../app/components/DateTimeInput';
import { parseEventExtraction } from '../lib/event-extraction';

const evidence = '个人申请截止时间：10月18日（周日）17：30';
const source = `${evidence}。联系人：王老师 邮箱：notice@example.org。某学院2026年10月13日`;
const draft = parseEventExtraction(JSON.stringify({ title: '演示奖学金', summary: '', eligibility: '', submit_to: '', deadline: null, deadline_source_text: evidence, materials: [] }), source, null, null);
let root: Root | null = null, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ categories: [], contacts: [], notice_supported: true })));
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; container.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode) { root = createRoot(container); await act(async () => root!.render(node)); }
const input = (label: string) => { const node = [...container.querySelectorAll('label')].find(node => node.textContent === label)!; return document.getElementById(node.htmlFor) as HTMLInputElement || node.querySelector('input')!; };
async function fill(node: HTMLInputElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }); }

describe('事项日期交互', () => {
  it('截止时间统一格式；日期/依据变化撤销确认，手动修改得到保护并可明确采用解析建议', async () => {
    function Editor() {
      const [value, setValue] = useState(draft), [confirmed, setConfirmed] = useState(false), [valid, setValid] = useState(true);
      return <><EventEditor value={value} onChange={setValue} confirmed={confirmed} onConfirm={setConfirmed} onDateValidityChange={setValid} /><output>{confirmed ? 'confirmed' : 'pending'}</output><button disabled={!confirmed || !valid}>保存</button></>;
    }
    await render(<Editor />);
    const deadline = input('截止时间（上海时间）');
    expect(deadline.type).toBe('text'); expect(deadline.value).toBe('2026/10/18 17:30'); expect(container.textContent).toContain('根据落款年份补全');
    const confirmation = [...container.querySelectorAll('label')].find(node => node.textContent?.includes('我已对照原通知确认截止时间'))!.querySelector('input')!;
    await act(async () => confirmation.click()); expect(container.querySelector('output')!.textContent).toBe('confirmed');
    await fill(input('发布日期'), '2026/10/14'); expect(container.querySelector('output')!.textContent).toBe('pending');
    await fill(deadline, '2026/10/18 18:00'); await act(async () => confirmation.click());
    await fill(input('发布日期'), '2026/10/15'); expect(deadline.value).toBe('2026/10/18 18:00'); expect(container.textContent).toContain('不会静默覆盖'); expect(container.querySelector('output')!.textContent).toBe('pending');
    const adopt = [...container.querySelectorAll('button')].find(button => button.textContent === '明确采用重新解析结果')!;
    await act(async () => adopt.click()); expect(deadline.value).toBe('2026/10/18 17:30');
    await fill(deadline, '2026/02/29 17:30'); expect(deadline.getAttribute('aria-invalid')).toBe('true'); expect(confirmation.disabled).toBe(true);
  });
  it('区分待确认年份和未发现时间，不以当前年份补齐', async () => {
    const noYear = parseEventExtraction(JSON.stringify({ title: '演示', summary: '', eligibility: '', submit_to: '', deadline: null, deadline_source_text: evidence, materials: [] }), evidence, null, null);
    await render(<EventEditor value={noYear} onChange={() => {}} confirmed={false} onConfirm={() => {}} />);
    expect(container.textContent).toContain('原文已发现截止日期，但年份待确认'); expect(container.textContent).not.toContain('原文未确认截止时间');
  });
  it('日期和时间同时严格校验，保留上海时区', () => {
    expect(parseDisplayDateTime('2026/10/18 17:30')).toBe('2026-10-18T09:30:00.000Z');
    expect(parseDisplayDateTime('2024/02/29 00:00')).toBe('2024-02-28T16:00:00.000Z');
    for (const value of ['2026/02/29 17:30', '2026/10/18 24:00', '2026/10/18 17:60', '2026-10-18T17:30']) expect(parseDisplayDateTime(value)).toBeNull();
  });
});

describe('事项联系人展示范围', () => {
  const contact = { id: 'test', name: '王老师', role: 'teacher' as const, phone: null, email: 'notice@example.org', office: null, office_hours: null };
  it('原文候选未确认不提供联系按钮；确认后本通知联系人优先，提供复制和发送邮件入口', async () => {
    await render(<EventContacts value={draft} />);
    expect(container.textContent).toContain('待老师核对'); expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    await act(async () => root!.render(<EventContacts value={{ ...draft, notice_contacts: [contact], category_contacts: [{ ...contact, id: 'other', name: '类别老师' }] }} />));
    expect(container.textContent).toContain('本通知联系人（已由老师核对）'); expect(container.textContent).not.toContain('类别老师'); expect(container.querySelector('a[href="mailto:notice@example.org"]')).not.toBeNull();
    expect(container.textContent).toContain('复制邮箱'); expect(container.textContent).toContain('发送邮件');
  });
  it('没有本通知联系人时单独标注类别咨询负责人，查询错误与空状态不同', async () => {
    await render(<EventContacts value={{ ...draft, category_contacts: [contact] }} />);
    expect(container.textContent).toContain('类别咨询负责人（非本通知联系人）');
    await act(async () => root!.render(<EventContacts value={{ ...draft, notice_contacts_error: 'CONTACTS_UNAVAILABLE' }} />));
    expect(container.textContent).toContain('联系人查询失败');
    expect(container.textContent).not.toContain('类别咨询负责人也尚未配置');
  });
});
