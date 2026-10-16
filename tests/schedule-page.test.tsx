// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentEvent } from '../lib/types';

vi.mock('../app/components/SiteHeader', () => ({ default: () => null }));
import Schedule from '../app/schedule/page';

const now = Date.parse('2026-10-16T08:00:00Z');
let root: Root | null = null;
let container: HTMLDivElement;
let events: StudentEvent[];
function event(id: string, status: StudentEvent['status'], deadline: string | null): StudentEvent {
  return { id, title: id, status, deadline, device_id: 'owner', summary: '', eligibility: '', submit_to: '', materials: [],
    deadline_source_text: null, deadline_inferred: false, source_text: '通知正文', source_url: null, publish_date: null,
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/events') return Response.json({ events });
    if (init?.method === 'PATCH') {
      const id = path.split('/').pop();
      const patch = JSON.parse(init.body as string);
      events = events.map(item => item.id === id ? { ...item, ...patch } : item);
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected request: ${path}`);
  }));
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; container.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function render(items: StudentEvent[]) {
  events = items;
  root = createRoot(container);
  await act(async () => root!.render(<Schedule />));
}
function titles() { return [...container.querySelectorAll('article h2')].map(node => node.textContent); }
async function filter(label: string) {
  const button = [...container.querySelectorAll('[aria-label="筛选事项"] button')].find(node => node.textContent?.startsWith(`${label}（`)) as HTMLButtonElement;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function action(label: string) {
  const button = [...container.querySelectorAll('article button')].find(node => node.textContent === label) as HTMLButtonElement;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

describe('日程页面筛选交互', () => {
  it('各筛选显示符合条件的事项和数量，无截止时间事项有独立入口', async () => {
    await render([
      event('无日期事项', 'active', null), event('远期事项', 'active', '2026-11-01T00:00:00Z'),
      event('近期事项', 'active', '2026-10-17T00:00:00Z'), event('过期事项', 'active', '2026-10-15T00:00:00Z'),
      event('完成事项', 'done', '2026-10-17T00:00:00Z'), event('归档事项', 'archived', null),
    ]);
    expect(titles()).toHaveLength(6);
    for (const [label, expected] of [
      ['进行中', ['无日期事项', '远期事项', '近期事项', '过期事项']], ['7 天内截止', ['近期事项']],
      ['已过期', ['过期事项']], ['无截止时间', ['无日期事项']], ['已完成', ['完成事项']], ['已归档', ['归档事项']],
    ] as const) {
      await filter(label); expect(titles()).toEqual([...expected]);
      expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe(`${label}（${expected.length}）`);
    }
  });
  it('完成、归档、取消归档和重启后立即更新所属筛选', async () => {
    await render([event('无日期事项', 'active', null)]);
    await filter('无截止时间'); await action('标记完成'); expect(titles()).toEqual([]);
    await filter('已完成'); expect(titles()).toEqual(['无日期事项']);
    await action('归档'); expect(titles()).toEqual([]);
    await filter('已归档'); expect(titles()).toEqual(['无日期事项']);
    await action('取消归档'); expect(titles()).toEqual([]);
    await filter('进行中'); expect(titles()).toEqual(['无日期事项']);
    await action('标记完成'); await filter('已完成'); await action('重启');
    await filter('无截止时间'); expect(titles()).toEqual(['无日期事项']);
  });
  it('跨过截止时间后自动从近期转为过期，数量和状态同步', async () => {
    await render([event('即将截止', 'active', new Date(now + 30_000).toISOString())]);
    await filter('7 天内截止'); expect(titles()).toEqual(['即将截止']);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(titles()).toEqual([]);
    await filter('已过期'); expect(titles()).toEqual(['即将截止']);
    expect(container.querySelector('.pill-error')?.textContent).toBe('已过期');
  });
});
