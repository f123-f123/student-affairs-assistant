// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '20000000-0000-4000-8000-000000000001' }) }));
vi.mock('../app/components/SiteHeader', () => ({ default: () => null }));
import Page from '../app/teacher/(protected)/tickets/[id]/page';
const id = '20000000-0000-4000-8000-000000000001', category = '10000000-0000-4000-8000-000000000008', other = '10000000-0000-4000-8000-000000000004';
const initial = () => ({ ticket: { id, question: '演示问题', category_id: category, status: 'answered', teacher_reply: '已保存回复', reply_version: 0, sedimented: false, knowledge_item_id: null, created_at: '2026-10-19', answered_at: null }, categories: [{ id: category, name: '综合事务' }, { id: other, name: '宿舍与后勤' }] });
const generated = { draft: { question: '公开演示问题', answer: '公开演示答案' }, reply_version: 0, reply_fingerprint: 'fingerprint' };
let root: Root, container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  fetcher = vi.fn(async () => Response.json(initial())); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<Page />)); }
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
const textarea = (index = 0) => container.querySelectorAll('textarea')[index];
async function click(text: string) { await act(async () => button(text).click()); }
async function fill(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function deferred() { let resolve!: (response: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; }
async function review() { await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); }

describe('老师工单编辑异步状态', () => {
  it('详情0版本启用保存；保存期间锁定编辑，成功不再刷新覆盖后续输入', async () => {
    const pending = deferred(); fetcher.mockImplementation(async (url: string) => url.endsWith('/reply') ? pending.promise : Response.json(initial()));
    await render(); expect(button('保存回复').disabled).toBe(false);
    await fill(textarea(), '新的输入'); await click('保存回复'); expect(textarea().disabled).toBe(true);
    // 禁用时即使收到迟到的输入事件也不能覆盖提交快照。
    await fill(textarea(), '保存期间输入');
    await act(async () => pending.resolve(Response.json({ ok: true, reply_version: 1, teacher_reply: '新的输入', answered_at: '2026-10-19' })));
    expect(textarea().value).toBe('新的输入'); expect(fetcher).toHaveBeenCalledTimes(2);
    await fill(textarea(), '保存后的新输入'); expect(textarea().value).toBe('保存后的新输入');
    expect(button('生成问答草稿').disabled).toBe(true);
  });
  it('生成期间锁定，生成后回复修改立即失效；恢复旧文本也不能恢复绑定', async () => {
    const pending = deferred(); fetcher.mockImplementation(async (url: string) => url.endsWith('/draft') ? pending.promise : Response.json(initial()));
    await render(); await click('生成问答草稿'); expect(textarea().disabled).toBe(true);
    await act(async () => pending.resolve(Response.json(generated)));
    await review(); expect(button('确认入库').disabled).toBe(false);
    await fill(textarea(), '修改回复'); await fill(textarea(), '已保存回复'); await review();
    expect(button('确认入库').disabled).toBe(true);
  });
  it('409保留输入，读取最新只展示对照；明确采用版本后才允许重存', async () => {
    let gets = 0;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/reply')) return Response.json({ error: '版本冲突', code: 'REPLY_VERSION_CONFLICT' }, { status: 409 });
      const data = initial(); if (++gets > 1) { data.ticket.reply_version = 1; data.ticket.teacher_reply = '另一位老师的新回复'; } return Response.json(data);
    });
    await render(); await fill(textarea(), '我的未保存输入'); await click('保存回复');
    expect(textarea().value).toBe('我的未保存输入'); expect(button('保存回复').disabled).toBe(true);
    await click('版本冲突：读取最新回复并对照'); expect(container.textContent).toContain('另一位老师的新回复'); expect(textarea().value).toBe('我的未保存输入');
    await click('保留当前输入，使用最新版本重新编辑'); expect(textarea().value).toBe('我的未保存输入'); expect(button('保存回复').disabled).toBe(false);
  });
  it('公开审核默认未勾选、依据为空；入库成功但刷新失败不会提示重新入库', async () => {
    let reads = 0;
    fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/draft')) return Response.json(generated);
      if (url.endsWith('/confirm')) {
        expect(JSON.parse(String(options!.body))).toMatchObject({ public_reviewed: true, public_excerpt: '经过审核的通用说明' });
        return Response.json({ knowledge_item_id: '30000000-0000-4000-8000-000000000001' }, { status: 201 });
      }
      if (++reads > 1) throw new Error('network'); return Response.json(initial());
    });
    await render(); await click('生成问答草稿'); expect(textarea(3).value).toBe(''); expect(button('确认入库').disabled).toBe(true);
    await fill(textarea(3), '经过审核的通用说明'); await review(); await click('确认入库');
    expect(container.textContent).toContain('入库已成功，但详情刷新失败'); expect(button('确认入库')).toBeUndefined(); expect(textarea().value).toBe('已保存回复');
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it('审核内容修改须重新勾选', async () => {
    fetcher.mockImplementation(async (url: string) => url.endsWith('/draft') ? Response.json(generated) : Response.json(initial()));
    await render(); await click('生成问答草稿'); await review(); expect(button('确认入库').disabled).toBe(false);
    await fill(textarea(2), '审核修改答案'); expect(button('确认入库').disabled).toBe(true);
  });
  it('详情缺版本不会默认0，也不指示反复执行迁移', async () => {
    fetcher.mockResolvedValue(Response.json({ ...initial(), ticket: { ...initial().ticket, reply_version: undefined } }));
    await render(); expect(container.textContent).toContain('TICKET_RESPONSE_INVALID'); expect(container.textContent).not.toContain('migration_'); expect(button('保存回复')).toBeUndefined();
  });
  it('保存网络失败保留输入，先对照最新状态；读取期间编辑锁定，完成也不覆盖', async () => {
    const pending = deferred(); let reads = 0;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/reply')) throw new Error('network');
      return ++reads === 1 ? Response.json(initial()) : pending.promise;
    });
    await render(); await fill(textarea(), '必须保留的新输入'); await click('保存回复');
    expect(container.textContent).toContain('写请求可能已完成'); expect(textarea().value).toBe('必须保留的新输入');
    await click('读取最新状态（保留输入）'); expect(textarea().disabled).toBe(true);
    const data = initial(); data.ticket.reply_version = 1; data.ticket.teacher_reply = '服务端已保存的回复';
    await act(async () => pending.resolve(Response.json(data)));
    expect(textarea().value).toBe('必须保留的新输入'); expect(container.textContent).toContain('服务端已保存的回复');
    await fill(textarea(), '对照后继续编辑'); expect(textarea().value).toBe('对照后继续编辑');
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it('候选按需分页、失败可重试；类别切换清空选择并丢弃旧查询', async () => {
    const late = deferred(); let categoryCalls = 0;
    fetcher.mockImplementation(async (url: string) => {
      if (!url.includes('ticket-candidates')) return Response.json(initial());
      const params = new URL(url, 'http://localhost').searchParams, selected = params.get('category_id'), page = Number(params.get('page'));
      if (selected === category && ++categoryCalls === 1) return Response.json({ error: '候选失败' }, { status: 503 });
      if (selected === category && categoryCalls === 3) return late.promise;
      return Response.json({ category_id: selected, page, page_size: 10, total: 12, items: [{ id: `${selected}-item`, category_id: selected, question: selected === other ? '宿舍新类别' : '综合候选', answer: '答案', updated_at: '2026-10-19' }] });
    });
    await render(); expect(fetcher).toHaveBeenCalledTimes(1); await click('查看替换候选（可选）'); expect(container.textContent).toContain('候选失败'); expect(button('保存回复').disabled).toBe(false);
    await click('重试候选'); await click('选择替换'); expect(container.textContent).toContain('已选替换条目');
    await click('下一页'); await fill(container.querySelector('select')!, other);
    expect(container.textContent).not.toContain('已选替换条目'); expect(container.textContent).toContain('宿舍新类别');
    await act(async () => late.resolve(Response.json({ category_id: category, page: 2, page_size: 10, total: 12, items: [{ id: 'late', category_id: category, question: '不该出现的过期结果', answer: '答案', updated_at: '2026-10-19' }] })));
    expect(container.textContent).not.toContain('不该出现的过期结果'); expect(container.textContent).toContain('宿舍新类别');
  });
});
