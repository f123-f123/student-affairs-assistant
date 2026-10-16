'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PublicUser } from '@/lib/auth-core';

type IdentityState = { user: PublicUser | null; passcodeEnabled: boolean; mockEnabled: boolean; legacyEnabled: boolean };

export default function IdentityControls() {
  const pathname = usePathname();
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' }).then(response => response.json()).then((result: IdentityState) => {
      setState(result);
      if ((result.passcodeEnabled || result.mockEnabled) && !result.user && pathname !== '/teacher/login') {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      }
    }).catch(() => setError('身份状态加载失败'));
  }, [pathname]);

  async function logout() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error('退出失败，请重试');
      sessionStorage.removeItem('student_active_conversation');
      document.body.style.visibility = 'hidden';
      window.location.replace(state?.legacyEnabled ? '/teacher/login' : '/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出失败，请重试');
      setBusy(false);
    }
  }

  return <div className="header-identity" aria-label="当前身份">
    {state?.user ? <><span className="header-user">{state.user.displayName}</span>{(state.passcodeEnabled || state.mockEnabled) && <Link href="/login" className="header-identity-link">切换身份</Link>}<button type="button" disabled={busy} onClick={() => void logout()} className="header-identity-link">退出</button></>
      : !(state?.passcodeEnabled || state?.mockEnabled) && <Link href={state?.legacyEnabled ? '/teacher/login' : '/login'} className="header-identity-link">登录</Link>}
    {error && <span role="alert" className="header-error">{error}</span>}
  </div>;
}
