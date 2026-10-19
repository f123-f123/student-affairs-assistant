// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportNoticeContacts from '../app/components/ImportNoticeContacts';
import NoticeContactGroups from '../app/components/NoticeContactGroups';
import type { NoticeContactGroup } from '../lib/types';

let root: Root | null, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; container.remove(); vi.unstubAllGlobals(); });
const contact = { id: 'public-contact', name: '王老师', role: 'teacher' as const, email: 'zjuwangxu@zju.edu.cn', phone: null, office: null, office_hours: null };
const group: NoticeContactGroup = { import_id: 'batch', category_id: 'award', item_ids: ['knowledge'], title: '云峰学园通知', source_url: 'https://example.org/notice', scope_label: '云峰学园2025级2025-2026学年', state: 'confirmed', contacts: [contact], category_contacts: [] };
async function render(element: React.ReactNode) { root = createRoot(container); await act(async () => root!.render(element)); }
describe('通知联系人审核及分组界面', () => {
  it('本通知联系人显示可用邮箱入口，澄清候选明确尚未确认资格', async () => {
    await render(<NoticeContactGroups groups={[group]} pending />);
    expect(container.textContent).toContain('该通知联系人'); expect(container.textContent).toContain('咨询范围尚待确认');
    expect(container.querySelector('a[href="mailto:zjuwangxu@zju.edu.cn"]')).not.toBeNull(); expect(container.textContent).not.toContain('类别暂无咨询负责人');
  });
  it.each(['unreviewed', 'unavailable', 'source_changed'] as const)('分别显示联系人状态和类别兜底：%s', async state => {
    await render(<NoticeContactGroups groups={[{ ...group, state, contacts: [] }]} />);
    expect(container.textContent).toContain(state === 'unreviewed' ? '本通知尚未审核联系人' : state === 'unavailable' ? '联系人读取失败' : '联系人需要老师重新核对');
    expect(container.textContent).toContain('类别暂无咨询负责人'); expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });
  it('同URL私人记录只是提示，老师勾选公开范围后才能确认，知识状态与联系人状态独立', async () => {
    const data: any = { contacts: [], version: 0, source_hash: 'fingerprint', status: 'unreviewed', source_changed: false, scope_label: group.scope_label,
      candidates: [{ ...contact, source_excerpt: '王老师 邮箱：zjuwangxu@zju.edu.cn', private_matches: 2 }] };
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') { const body = JSON.parse(options.body as string); expect(body.confirm_source).toBe(true); expect(body.action).toBe('approve');
        data.contacts = [{ ...contact, valid: true, reviewed_at: '2026-10-19', reviewed_by: 'teacher' }]; data.version++; data.status = 'confirmed'; return Response.json({ id: contact.id }); }
      return Response.json(data);
    }); vi.stubGlobal('fetch', fetchMock);
    await render(<ImportNoticeContacts batchId="batch" categoryId="award" knowledgeStatus="已发布" disabled={false} onLocate={() => {}} />);
    const save = () => [...container.querySelectorAll('button')].find(button => button.textContent === '确认并保存本通知联系人')!;
    expect(save().disabled).toBe(true); expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
    expect(container.textContent).toContain('知识状态：已发布'); expect(container.textContent).toContain('同 URL 的私人事项');
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); await act(async () => save().click());
    expect(container.textContent).toContain('联系人状态：已审核'); expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });
});
