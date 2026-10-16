import { describe, expect, it } from 'vitest';
import { parseKnowledgeInput } from '../lib/knowledge-input';

const fields = { category_id: '10000000-0000-4000-8000-000000000008', question: ' 办理申请 ', answer: ' 提交申请表 ',
  source_name: ' 通知 ', source_url: ' https://school.example/notice ', source_excerpt: '', aliases: [' 申请 ', '申请', ''],
  valid_from: '2026-10-16T08:00:00+08:00', valid_until: '2026-10-16T01:00:00Z' };

describe('知识输入', () => {
  it('时区统一后比较生效区间，别名去重且移除空白', () => {
    expect(parseKnowledgeInput(fields)).toMatchObject({ question: '办理申请', answer: '提交申请表', source_name: '通知',
      source_url: 'https://school.example/notice', source_excerpt: null, aliases: ['申请'],
      valid_from: '2026-10-16T00:00:00.000Z', valid_until: '2026-10-16T01:00:00.000Z' });
    expect(() => parseKnowledgeInput({ ...fields, valid_until: '2026-10-15T23:00:00Z' })).toThrow('知识内容无效');
  });
  it.each(['https://', 'javascript:alert(1)', 'https://user:secret@school.example/notice'])('拒绝不合法的出处链接 %s', source_url => {
    expect(() => parseKnowledgeInput({ ...fields, source_url })).toThrow('来源链接无效');
  });
  it.each(['2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T09:00:00', '1'])('拒绝不存在或时区不明确的日期 %s', valid_from => {
    expect(() => parseKnowledgeInput({ ...fields, valid_from })).toThrow('知识内容无效');
  });
});
