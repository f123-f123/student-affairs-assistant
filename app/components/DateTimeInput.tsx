'use client';
import { useEffect, useId, useState } from 'react';
import { parseDisplayDate } from '@/lib/date-only';
import { fromShanghaiInput, shanghaiDateTime } from '@/lib/event-date';

export function parseDisplayDateTime(text: string) {
  if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(text)) return null;
  const date = parseDisplayDate(text.slice(0, 10));
  return date ? fromShanghaiInput(`${date}T${text.slice(11)}`) : null;
}
export default function DateTimeInput({ value, onChange, onValidityChange }: {
  value: string | null; onChange: (value: string | null) => void; onValidityChange: (valid: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value ? shanghaiDateTime(value) : '');
  const valid = !text || !!parseDisplayDateTime(text);
  useEffect(() => { setText(value ? shanghaiDateTime(value) : ''); }, [value]);
  return <div className="space-y-1"><label htmlFor={id} className="field-label">截止时间（上海时间）</label>
    <div className="flex gap-2"><input id={id} type="text" className="field min-w-0" inputMode="text" placeholder="年/月/日 时:分" maxLength={16}
      value={text} aria-invalid={!valid} aria-describedby={`${id}-hint`} onChange={event => {
        const next = event.target.value; setText(next);
        const parsed = parseDisplayDateTime(next); onValidityChange(!next || !!parsed);
        if (!next || parsed) onChange(parsed);
      }} /><button type="button" className="button-secondary" aria-label="清空截止时间" disabled={!text} onClick={() => { setText(''); onChange(null); onValidityChange(true); }}>清空</button></div>
    <p id={`${id}-hint`} className={valid ? 'muted text-sm' : 'notice notice-error'}>{valid ? 'YYYY/MM/DD HH:mm，上海时间' : '请输入有效日期和时间，格式 YYYY/MM/DD HH:mm'}</p>
  </div>;
}
