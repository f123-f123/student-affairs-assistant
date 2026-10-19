// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskResponse, Contact } from '../lib/types';
import DateInput from '../app/components/DateInput';
import ContactCard from '../app/components/ContactCard';
import { CategoryContacts } from '../app/components/TeacherContacts';
vi.mock('../app/components/SiteHeader', () => ({ default: () => null }));
import Home from '../app/page';

let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); sessionStorage.clear(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; container.remove(); vi.unstubAllGlobals(); });
async function render(element: React.ReactNode) { root = createRoot(container); await act(async () => root!.render(element)); }
const contact: Contact = { id: 'test', name: '演示联系人', role: 'teacher', phone: '13800000000', email: 'demo@example.org', office: null, office_hours: null };
const id = '10000000-0000-4000-8000-000000000004';
function history(response: AskResponse) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return Response.json({ user: { id: 'student', role: 'student', displayName: '学生' } });
    if (url === '/api/conversations') return Response.json({ conversations: [{ id, title: '历史', created_at: '2026-10-19', updated_at: '2026-10-19' }] });
    if (url.startsWith('/api/ask?')) return Response.json({ history: [{ question: '怎么办理', response }] });
    throw new Error(`unexpected ${url}`);
  }));
}

describe('聊天与负责人状态', () => {
  it('needs_scope 在每个候选下展示本通知联系人，不混成一个当前负责人', async () => {
    const person = { ...contact, id: 'public-contact', name: '王老师', email: 'zjuwangxu@zju.edu.cn' };
    history({ answerable: false, status: 'needs_scope', notice: '请选择通知范围', citations: [], contacts: [], category_id: id,
      scope_candidates: [{ id: 'notice', version: 1, label: '云峰学园2025级2025-2026学年', missing_fields: ['学院/学园'], source_name: '云峰通知', source_url: 'https://example.org',
        notice_contact_groups: [{ import_id: 'batch', item_ids: ['notice'], category_id: id, title: '云峰通知', source_url: 'https://example.org', scope_label: '云峰学园2025级2025-2026学年', state: 'confirmed', contacts: [person], category_contacts: [] }] }] });
    await render(<Home />); expect(container.textContent).toContain('该通知联系人'); expect(container.textContent).not.toContain('当前负责人');
    expect(container.querySelector('a[href="mailto:zjuwangxu@zju.edu.cn"]')).not.toBeNull();
  });
  it.each([
    ['no_knowledge', '没有相关知识'], ['needs_scope', '请确认咨询范围'], ['model_refused', '模型未能依据资料回答'], ['validation_failed', '回答校验未通过'],
  ] as const)('界面单独展示问答状态：%s', async (status, title) => {
    history({ status, answerable: false, notice: '本状态的具体说明', citations: [], contacts: [], category_id: id,
      ...(status === 'needs_scope' ? { scope_candidates: [{ id: 'notice', version: 1, label: '云峰学园2025级2025-2026学年二等奖学金', missing_fields: ['年度/学年'], source_name: '官网通知', source_url: null }] } : {}) });
    await render(<Home />); expect(container.textContent).toContain(title); expect(container.textContent).not.toContain('知识不足');
    if (status === 'needs_scope') expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('咨询第1项：云峰学园'))).toBe(true);
  });
  it.each([true, false])('可答与不可答均显示空状态和工单入口：%s', async answerable => {
    history({ answerable, ...(answerable ? { answer: '可以按依据办理。' } : {}), citations: [], contacts: [], category_id: id });
    await render(<Home />);
    expect(container.textContent).toContain('当前负责人'); expect(container.textContent).toContain('该类别尚未配置负责人');
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === (answerable ? '仍未解决？请老师确认' : '提交工单给老师'))!;
    await act(async () => button.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });
  it('联系人查询异常单独显示重试，五步按换行展示，不替换回答', async () => {
    history({ answerable: true, answer: '按以下步骤：1. 核对。2. 填写。3. 提交。4. 查看。5. 完成。', citations: [], contacts: [], category_id: id, contacts_error: 'CONTACTS_UNAVAILABLE' });
    await render(<Home />);
    expect(container.textContent).toContain('负责人查询失败'); expect(container.textContent).not.toContain('该类别尚未配置负责人');
    expect(container.querySelector('.answer-text')?.textContent?.split('\n')).toHaveLength(6);
    expect(container.querySelector('.answer-text')?.className).toContain('answer-text');
  });
  it('演示联系人没有实际拨号或邮件入口，真实联系人保留入口', async () => {
    await render(<ContactCard contact={contact} />);
    expect(container.textContent).toContain('演示联系人，非真实联系方式'); expect(container.querySelector('a')).toBeNull();
    await act(async () => root!.render(<ContactCard contact={{ ...contact, name: '已核实老师' }} />));
    expect(container.querySelector('a[href^="tel:"]')).not.toBeNull(); expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });
  it('老师所选类别区分空、查询异常和负责人', async () => {
    await render(<CategoryContacts state={{ loading: false, error: '', contacts: [] }} categoryId={id} />);
    expect(container.textContent).toContain('该类别尚未配置负责人'); expect(container.textContent).toContain('不会自动关联当前老师');
    await act(async () => root!.render(<CategoryContacts state={{ loading: false, error: '读取失败', contacts: [] }} categoryId={id} />));
    expect(container.textContent).toContain('读取失败'); expect(container.textContent).not.toContain('尚未配置');
    await act(async () => root!.render(<CategoryContacts state={{ loading: false, error: '', contacts: [{ ...contact, category_id: id }] }} categoryId={id} />));
    expect(container.textContent).toContain('演示联系人，非真实联系方式');
  });
});

describe('可控发布日期输入', () => {
  it.each(['zh-CN', 'en-US'])('语言 %s 下斜杠显示，非法日期阻止提交，合法闰日保存为 ISO，支持清空', async language => {
    document.documentElement.lang = language;
    function Form() {
      const [value, setValue] = useState<string | null>('2026-10-19');
      const [valid, setValid] = useState(true);
      return <><DateInput value={value} onChange={setValue} onValidityChange={setValid} /><output>{value || 'null'}</output><button disabled={!valid}>保存</button></>;
    }
    await render(<Form />);
    const input = container.querySelector('input')!;
    expect(input.type).toBe('text'); expect(input.value).toBe('2026/10/19');
    async function fill(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
    await fill('2026/02/29'); expect(input.getAttribute('aria-invalid')).toBe('true'); expect([...container.querySelectorAll('button')].find(button => button.textContent === '保存')!.disabled).toBe(true);
    await fill('2024/02/29'); expect(input.value).toBe('2024/02/29'); expect(container.querySelector('output')!.textContent).toBe('2024-02-29');
    await act(async () => (container.querySelector('[aria-label="清空发布日期"]') as HTMLButtonElement).click());
    expect(input.value).toBe(''); expect(container.querySelector('output')!.textContent).toBe('null'); expect(input.placeholder).toBe('年/月/日');
  });
});
