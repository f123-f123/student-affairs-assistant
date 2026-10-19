'use client';
import { useEffect, useId, useState } from 'react';
import { displayDate, parseDisplayDate } from '@/lib/date-only';

export default function DateInput({ value, onChange, onValidityChange, label = '发布日期' }: {
  value: string | null; onChange: (value: string | null) => void; onValidityChange?: (valid: boolean) => void; label?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value ? displayDate(value) : '');
  const valid = !text || !!parseDisplayDate(text);
  useEffect(() => { setText(value ? displayDate(value) : ''); }, [value]);
  return <div className="space-y-1"><label className="field-label" htmlFor={id}>{label}</label>
    <div className="flex max-w-xs gap-2"><input id={id} type="text" inputMode="text" placeholder="年/月/日" aria-describedby={`${id}-hint`} aria-invalid={!valid}
      className="field min-w-0" value={text} maxLength={10} onChange={event => {
        const next = event.target.value; setText(next);
        const parsed = parseDisplayDate(next);
        onValidityChange?.(!next || !!parsed);
        if (!next || parsed) onChange(parsed);
      }} /><button type="button" className="button-secondary" aria-label={`清空${label}`} disabled={!text} onClick={() => { setText(''); onChange(null); onValidityChange?.(true); }}>清空</button></div>
    <p id={`${id}-hint`} className={valid ? 'muted text-sm' : 'text-sm notice-error'}>{valid ? 'YYYY/MM/DD；未知可留空' : '请输入有效日期，格式 YYYY/MM/DD'}</p>
  </div>;
}
