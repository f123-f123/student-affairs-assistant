'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicUser } from '@/lib/auth-core';

type IdentityState = { user: PublicUser | null; passcodeEnabled: boolean; mockEnabled: boolean };

export default function LoginPage() {
  const [state, setState] = useState<IdentityState | null>(null);
  const [account, setAccount] = useState('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' }).then(response => response.json()).then(setState).catch(() => setError('登录配置加载失败，请刷新页面重试'));
  }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(state?.passcodeEnabled || state?.mockEnabled) || loading) return;
    setLoading(true); setError('');
    try {
      const mock = state.mockEnabled;
      const response = await fetch(mock ? '/api/auth/mock-login' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mock ? { identity: account } : { account: account.trim(), passcode }), cache: 'no-store',
      });
      const result = await response.json() as { error?: string; role?: 'student' | 'teacher'; user?: PublicUser };
      if (!response.ok) throw new Error(result.error || '登录失败，请重试');
      sessionStorage.removeItem('student_active_conversation');
      document.body.style.visibility = 'hidden';
      const next = new URLSearchParams(window.location.search).get('next');
      const studentDestination = next && ['/', '/schedule', '/my', '/add'].includes(next) ? next : '/';
      window.location.replace((result.role || result.user?.role) === 'teacher' ? '/teacher' : studentDestination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试');
      setLoading(false);
    }
  }

  return <main className="zjuam-page">
    <div className="zjuam-topbar"><div className="zjuam-brand"><span className="zjuam-mark" aria-hidden="true">知</span><span>学生事务助手<br /><small>统一身份入口</small></span></div></div>
    <div className="zjuam-main"><section className="zjuam-intro"><p className="zjuam-kicker">STUDENT AFFAIRS · SIGN IN</p><h1>欢迎使用学生事务助手</h1><p>登录后查看个人问答、日程和工单；老师可进入工作台处理学生事务。</p><div className="zjuam-intro-note">模拟接入，仅用于评估。校园统一认证尚未接通，请勿输入校园账号、校园密码或验证码。</div></section>
      <section className="zjuam-card" aria-labelledby="login-title"><div className="zjuam-card-head"><span className="zjuam-card-eyebrow">身份登录</span><h2 id="login-title">登录</h2><p>输入账号和口令</p></div>
        {state === null && !error ? <p role="status" className="notice">正在检查登录配置…</p> : state?.passcodeEnabled || state?.mockEnabled ? <form onSubmit={event => void login(event)} className="zjuam-form"><p className="notice notice-warning mb-4">模拟接入，仅用于评估</p>{state.mockEnabled ? <label className="field-label">测试身份<select className="field" value={account} onChange={event => setAccount(event.target.value)} required><option value="">请选择</option><option value="student-a">学生 A</option><option value="student-b">学生 B</option><option value="teacher">老师</option></select></label> : <><label className="field-label">账号<input type="text" value={account} onChange={event => setAccount(event.target.value)} autoComplete="username" required className="field" /></label><label className="field-label mt-5">口令<input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoComplete="off" className="field" /></label></>}<button type="submit" className="zjuam-submit" disabled={loading}>{loading ? '正在登录…' : '登录'}</button></form> : <p className="notice notice-warning">当前登录方式未配置，请联系管理员。</p>}
        {error && <p role="alert" className="notice notice-error mt-4">{error}</p>}
        {state?.user && <p className="zjuam-current">当前身份：{state.user.displayName} · <Link href={state.user.role === 'teacher' ? '/teacher' : '/'}>返回工作区</Link></p>}
      </section></div>
    <footer className="zjuam-footer">学生事务助手</footer>
  </main>;
}
