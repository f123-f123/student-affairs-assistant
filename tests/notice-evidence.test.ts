import { describe, expect, it } from 'vitest';
import { noticeEvidence } from '../lib/notice-evidence';
import type { StudentEvent } from '../lib/types';

describe('通知问答来源', () => {
  it('只使用未归档事项的原文，并标记未经老师核验', () => {
    const base = { id: 'notice-1', title: '评奖通知', source_text: '10月18日前在ETA系统申请。', source_url: null,
      status: 'active', updated_at: '2026-10-13T00:00:00Z' } as StudentEvent;
    const result = noticeEvidence([base, { ...base, id: 'notice-2', status: 'archived' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ answer: base.source_text, source_type: 'saved_notice', source_level: 3 });
  });
});
