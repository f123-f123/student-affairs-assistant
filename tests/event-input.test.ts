import { describe, expect, it } from 'vitest';
import { parseEventInput, parseEventMaterials } from '../lib/event-input';

const draft = {
  title: '申请事项', summary: '', eligibility: '', submit_to: '', source_text: '通知原文',
  deadline: null, deadline_source_text: null, deadline_inferred: false, source_url: null, publish_date: null,
  materials: [{ name: ' 申请表 ', done: false, source_text: ' 提交申请表 ' }],
};

describe('事项材料校验', () => {
  it('截止时间不能把不存在的2月30日自动滚动到3月', () => {
    expect(() => parseEventInput({ ...draft, deadline: '2026-02-30T12:00:00Z', deadline_source_text: '通知原文' })).toThrow('截止时间无效');
  });
  it('创建事项和更新材料使用相同的归一化结果', () => {
    expect(parseEventInput(draft).materials).toEqual(parseEventMaterials(draft.materials));
    expect(parseEventMaterials(draft.materials)).toEqual([{ name: '申请表', done: false, source_text: '提交申请表' }]);
  });
  it.each([null, {}, [null], [{ name: ' ', done: false, source_text: '' }],
    [{ name: '申请表', done: 'false', source_text: '' }], Array(101).fill(draft.materials[0])])('拒绝无效材料 %j', materials => {
    expect(() => parseEventMaterials(materials)).toThrow('材料内容无效');
    expect(() => parseEventInput({ ...draft, materials })).toThrow('材料内容无效');
  });
});
