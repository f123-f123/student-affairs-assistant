// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../app/components/IdentityControls', () => ({ default: () => null }));

import Home from '../app/page';

const user = { id: 'a1000000-0000-4000-8000-000000000001', displayName: '学生A', role: 'student' };
const oldConversation = { id: 'c1000000-0000-4000-8000-000000000001', title: '旧对话', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
const newConversation = { ...oldConversation, id: 'c1000000-0000-4000-8000-000000000002', title: '新对话' };
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('问答页独立加载状态', () => {
  it('单条历史 503 后仍可新建对话，且没有伪造记录', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const storage = () => {
      const values = new Map<string, string>();
      return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
    };
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/auth/me') return Response.json({ user });
      if (input === '/api/conversations' && init?.method === 'POST') return Response.json({ conversation: newConversation }, { status: 201 });
      if (input === '/api/conversations') return Response.json({ conversations: [oldConversation] });
      if (input.startsWith('/api/ask?')) return Response.json({ code: 'DATABASE_UNAVAILABLE' }, { status: 503 });
      throw new Error(`unexpected request: ${input}`);
    }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Home />));
    await flush();
    await flush();
    expect(container.textContent).toContain('问答记录：数据库暂时不可用');
    const create = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('新对话'))!;
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    await flush();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([path, init]) => path === '/api/conversations' && init?.method === 'POST')).toBe(true);
    expect(container.querySelectorAll('.chat-message')).toHaveLength(0);
  });
});
