import { describe, expect, it } from 'vitest';
import { parseDraft } from '../lib/draft';

describe('parseDraft', () => {
  it('解析围栏与前后说明文字', () => {
    expect(parseDraft('```json\n{"question":" 缓考怎么申请？ ","answer":" 联系教务老师。 "}\n```')).toEqual({ question: '缓考怎么申请？', answer: '联系教务老师。' });
    expect(parseDraft('草稿：{"question":"问题","answer":"答案"}请核对')).toEqual({ question: '问题', answer: '答案' });
  });
  it('错误 JSON 和缺字段会失败', () => {
    expect(() => parseDraft('{broken')).toThrow('invalid_draft');
    expect(() => parseDraft('{"question":"问题"}')).toThrow('invalid_draft');
  });
  it('移除常见电话、邮箱和学号格式', () => {
    expect(parseDraft('{"question":"我的学号123456789012怎么办？","answer":"联系13800000001或test@example.com"}'))
      .toEqual({ question: '我的学号[编号已移除]怎么办？', answer: '联系[电话已移除]或[邮箱已移除]' });
  });
});
