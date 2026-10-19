// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfficialKnowledgeImport from '../app/components/OfficialKnowledgeImport';
let root: Root | null = null, container: HTMLDivElement;
const id = '00000000-0000-4000-8000-000000000001';
const state = { batch: { id, requested_url: 'https://example.org/notice', source_url: 'https://example.org/notice', title: '演示通知', source_text: '云峰学园2025级原文依据。', date_candidates: [], attachments: [{ name: '表格.docx', url: 'https://example.org/form.docx', format: 'docx', status: 'unparsed' }], published_date: null, fetched_at: '2026-10-19', version: 1 },
  categories: [{ id, name: '奖学金' }], drafts: [{ id: 'draft', version: 1, status: 'draft', data: { question: '原问题', answer: '原答案', aliases: [], category_id: id,
    scope: { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['演示奖学金'], conditions: [] }, excerpts: ['云峰学园2025级原文依据。'],
    issues: [] as string[], publication_date: null, attachment_dependency: false, date_confirmed: false, scope_confirmed: false, semantics_confirmed: false, supersedes: null }, validation: { errors: [] as string[], warnings: [] as string[] }, duplicates: [] }] };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); window.history.replaceState(null, '', `/?batch=${id}`);
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') return Response.json({ error: '并发版本冲突，请刷新', details: [{ id: 'draft', reasons: ['替换目标版本已变化'] }] }, { status: 409 });
    return Response.json(url.endsWith(`/imports/${id}`) ? state : { batches: [{ id, title: '演示通知', status: 'review' }] });
  }));
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; container.remove(); vi.unstubAllGlobals(); });
async function mount() { root = createRoot(container); await act(async () => root!.render(<OfficialKnowledgeImport />)); }
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
function editableServer(data = structuredClone(state)) {
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.method === 'PATCH') {
      const input = JSON.parse(options.body as string);
      data.drafts = input.drafts.map((d: typeof data.drafts[number]) => ({ ...d, version: d.version + 1, validation: { errors: [], warnings: [] }, duplicates: [] }));
      data.batch.version++; return Response.json({ saved: true });
    }
    if (String(url).endsWith('/publish')) return Response.json({ result: { count: 1, ids: ['draft'] } });
    return Response.json(String(url).endsWith(`/imports/${id}`) ? data : { batches: [] });
  });
  return data;
}
describe('官网导入审核界面', () => {
  it('刷新按批次恢复、展示原文和未解析附件，手机有切换视图入口', async () => {
    await mount(); expect(container.textContent).toContain('演示通知'); expect(container.textContent).toContain('未解析（docx）');
    expect(container.querySelector('[aria-label="原文与草稿视图"]')).not.toBeNull(); expect(container.querySelector('textarea')!.value).toBe('原问题');
    expect(container.textContent).toContain('确定性检查通过，仍须人工审核');
  });
  it('编辑撤销确认、阻止发布旧版本，保存失败保留人工内容', async () => {
    await mount(); const textarea = container.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '人工编辑的新问题'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    const publish = [...container.querySelectorAll('button')].find(b => b.textContent === '审核并发布所选草稿')!; expect(publish.disabled).toBe(true);
    const save = [...container.querySelectorAll('button')].find(b => b.textContent === '保存草稿与校验')!;
    await act(async () => save.click()); expect(textarea.value).toBe('人工编辑的新问题'); expect(container.textContent).toContain('并发版本冲突');
    expect(container.textContent).toContain('已有原文和编辑内容保留');
    expect(container.textContent).toContain('替换目标版本已变化');
    expect(container.textContent).not.toContain('"id":');
  });
  it('未确认时明确提示并禁用发布，一次确认保存后能发布，继续编辑会撤销确认', async () => {
    const live = editableServer(); await mount();
    expect(button('审核并发布所选草稿').disabled).toBe(true); expect(container.textContent).toContain('请勾选下方审核确认');
    const review = [...container.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement!.textContent!.includes('我已核对')) as HTMLInputElement;
    await act(async () => review.click()); expect(button('审核并发布所选草稿').disabled).toBe(true);
    await act(async () => button('保存草稿与校验').click());
    expect(live.drafts[0].data).toMatchObject({ scope_confirmed: true, semantics_confirmed: true, date_confirmed: true });
    expect(button('审核并发布所选草稿').disabled).toBe(false);
    await act(async () => button('审核并发布所选草稿').click()); expect(container.textContent).toContain('已审核发布 1 条');
    const textarea = container.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '修改后需再审核'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((container.querySelector('input[type="checkbox"]:checked'))).toBeNull(); expect(button('审核并发布所选草稿').disabled).toBe(true);
  });
  it.each(['validation', 'issues'] as const)('已确认仍有%s阻碍时不能发布', async kind => {
    const live = structuredClone(state); Object.assign(live.drafts[0].data, { scope_confirmed: true, semantics_confirmed: true, date_confirmed: true });
    if (kind === 'validation') live.drafts[0].validation.errors = ['伪造摘录'];
    else live.drafts[0].data.issues = ['范围待核对'];
    editableServer(live); await mount(); expect(button('审核并发布所选草稿').disabled).toBe(true);
    expect(container.textContent).toContain(kind === 'validation' ? '伪造摘录' : '请先处理并清空');
  });
  it('有通知依据自动补全年份时显示依据，不额外要求确认年份', async () => {
    const live = structuredClone(state); Object.assign(live.drafts[0].data, { scope_confirmed: true, semantics_confirmed: true, date_confirmed: false });
    Object.assign(live.drafts[0].validation, { date_note: '根据正文落款 2026/10/13 自动补全年份：2026/10/18 17:30（上海时间），无需单独确认年份。' });
    editableServer(live); await mount(); expect(container.textContent).toContain('无需单独确认年份');
    expect(button('审核并发布所选草稿').disabled).toBe(false); expect(container.textContent).not.toContain('请核对补全日期并勾选审核确认');
  });
  it('旧批次一次只显示一条，选留当前草稿后其余内容以已忽略状态保存，刷新不会丢失', async () => {
    const live = structuredClone(state); live.drafts.push({ ...structuredClone(live.drafts[0]), id: 'other', data: { ...structuredClone(live.drafts[0].data), question: '另一条人工编辑问题' } });
    editableServer(live); await mount(); expect(container.querySelectorAll('article')).toHaveLength(1);
    await act(async () => button('仅保留当前草稿待审核').click()); await act(async () => button('保存草稿与校验').click());
    expect(live.drafts).toHaveLength(2); expect(live.drafts[1].status).toBe('ignored'); expect(live.drafts[1].data.question).toBe('另一条人工编辑问题');
    await act(async () => root!.unmount()); root = null; await mount(); expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(container.textContent).toContain('已忽略'); expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('原问题');
  });
  it('忽略当前草稿并保存后，不会发布列表中的其他草稿', async () => {
    const live = structuredClone(state); live.drafts.push({ ...structuredClone(live.drafts[0]), id: 'other', data: { ...structuredClone(live.drafts[0].data), scope_confirmed: true, semantics_confirmed: true, date_confirmed: true } });
    editableServer(live); await mount();
    await act(async () => button('忽略此草稿').click()); await act(async () => button('保存草稿与校验').click());
    expect(button('审核并发布所选草稿').disabled).toBe(true); expect(button('恢复草稿')).toBeDefined();
  });
});
