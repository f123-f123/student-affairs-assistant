'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SiteHeader from '@/app/components/SiteHeader';

export default function TeacherLogin() {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }), cache: 'no-store' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '登录失败');
      router.replace('/teacher');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : '登录失败'); }
    finally { setLoading(false); }
  }
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content flex min-h-[75dvh] items-center justify-center"><form onSubmit={submit} className="panel w-full max-w-md space-y-5">
    <div><p className="eyebrow">老师工作台</p><h1 className="text-2xl font-bold">欢迎回来</h1><p className="muted mt-2">输入管理口令，处理学生提交的问题。</p></div>
    <label className="field-label">管理口令<input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoComplete="current-password" className="field" /></label>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    <button disabled={loading || !passcode} className="button-primary w-full">{loading ? '登录中…' : '登录工作台'}</button>
  </form></main></div>;
}
