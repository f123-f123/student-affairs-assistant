import { afterEach, describe, expect, it, vi } from 'vitest';
import { askModel } from '../lib/llm';
import type { Category, KnowledgeItem } from '../lib/types';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('DeepSeek 模型接口', () => {
  it.each([
    [new TypeError('fetch failed'), 'model_request_failed'],
    [new DOMException('request timed out', 'TimeoutError'), 'model_timeout'],
  ])('网络故障及超时返回模型错误 %j', async (cause, expected) => {
    vi.stubEnv('LLM_API_KEY', 'test-only-key'); vi.stubEnv('LLM_MODEL', 'test-model');
    vi.stubEnv('LLM_PROVIDER', 'deepseek');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
    await expect(askModel('问题', [], [])).rejects.toThrow(expected);
  });
  it('上游响应损坏时返回稳定的模型响应错误', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-only-key'); vi.stubEnv('LLM_MODEL', 'test-model');
    vi.stubEnv('LLM_PROVIDER', 'deepseek');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }));
    await expect(askModel('问题', [], [])).rejects.toThrow('model_response_failed');
  });
  it('使用 JSON 模式且模型输入没有联系人', async () => {
    vi.stubEnv('LLM_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_API_KEY', 'test-only-key');
    vi.stubEnv('LLM_MODEL', 'deepseek-flash');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"answerable":false,"answer":"","citations":[],"category":null}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const categories: Category[] = [{ id: 'category-id', name: '综合事务', description: '考试安排', sort_order: 1 }];
    const items: KnowledgeItem[] = [{ id: 'item-id', category_id: 'category-id', question: '考试安排？', answer: '在教务系统查看。', source_level: 2, source_name: '演示', source_url: null, updated_at: '2026-01-01', categories: { name: '综合事务' } }];
    await askModel('考试安排？', categories, items);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options.cache).toBe('no-store');
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).not.toContain('contacts');
    expect(body.messages[0].content).not.toContain('13800000001');
  });
  it('模型只收到候选知识，不含个人通知或联系人', async () => {
    vi.stubEnv('LLM_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_API_KEY', 'test-only-key');
    vi.stubEnv('LLM_MODEL', 'deepseek-flash');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await askModel('在哪里报名？', [], [{ id: 'item-id', category_id: '', question: '报名通知', answer: '在青蓝平台报名。',
      source_level: 1, source_name: '老师审核', source_url: null, updated_at: '2026-10-13', categories: null }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toContain('在青蓝平台报名。');
    expect(body.messages[1].content).toContain('knowledge_items');
    expect(body.messages[1].content).not.toContain('saved_notices');
    expect(body.messages[1].content).not.toContain('contacts');
  });
});
