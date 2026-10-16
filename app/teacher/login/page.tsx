'use client';

import { useState } from 'react';
import SiteHeader from '@/app/components/SiteHeader';
import { useEffect } from 'react';

export default function TeacherLogin() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'loading' | 'legacy' | 'disabled'>('loading');
  useEffect(() => { void fetch('/api/auth/me', { cache: 'no-store' }).then(r => r.json()).then((data: { passcodeEnabled: boolean; mockEnabled: boolean; legacyEnabled: boolean }) => {
    if (data.passcodeEnabled || data.mockEnabled) window.location.replace('/login?next=%2Fteacher');
    else setMode(data.legacyEnabled ? 'legacy' : 'disabled');
  }).catch(() => setMode('disabled')); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }), cache: 'no-store' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '登录失败');
      window.location.replace('/teacher');
    } catch (err) { setError(err instanceof Error ? err.message : '登录失败'); }
    finally { setLoading(false); }
  }
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content reading-width space-y-5"><div className="page-head"><p className="eyebrow">老师工作台 / 身份</p><h1 className="page-title">身份接入</h1><p className="page-description">老师管理口令由服务端验证。</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="panel"><h2>统一认证</h2><p className="muted mt-2">未开通 · 尚未接入学校认证</p></div><div className="panel"><h2>浙大钉</h2><p className="muted mt-2">未开通 · 尚未接入</p></div></div>{mode === 'legacy' ? <form onSubmit={submit} className="panel space-y-5">
    <div><p className="eyebrow">老师工作台</p><h1 className="text-2xl font-bold">欢迎回来</h1><p className="muted mt-2">输入管理口令，处理学生提交的问题。</p></div>
    <label className="field-label">管理口令<input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoComplete="current-password" className="field" /></label>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    <button disabled={loading || !passcode} className="button-primary w-full">{loading ? '登录中…' : '登录工作台'}</button>
  </form> : <p className="notice">{mode === 'loading' ? '正在检查身份配置…' : '当前登录方式未配置。'}</p>}</main></div>;
}
