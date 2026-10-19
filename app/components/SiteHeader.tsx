'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import IdentityControls from './IdentityControls';

const studentLinks = [
  { href: '/', label: '问答' },
  { href: '/schedule', label: '我的日程' },
  { href: '/my', label: '我的工单' },
  { href: '/add', label: '添加事项' },
  { href: '/sources', label: '我的信息源' },
];

type ConversationNav = {
  authenticated: boolean; loading: boolean; creating: boolean; disabled: boolean;
  conversations: { id: string; title: string; updated_at: string }[];
  activeId: string; error?: string; createError?: string;
  onRetry: () => void; onCreate: () => void; onSelect: (id: string) => void;
};

export default function SiteHeader({ teacher = false, conversationNav }: { teacher?: boolean; conversationNav?: ConversationNav }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const links = teacher ? [{ href: '/teacher', label: '工单列表' }, { href: '/teacher/knowledge', label: '知识库' }] : studentLinks;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => {
      const saved = localStorage.getItem('student-affairs-theme');
      const next = saved === 'light' || saved === 'dark' ? saved : media.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    syncTheme();
    media.addEventListener('change', syncTheme);
    return () => media.removeEventListener('change', syncTheme);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('student-affairs-theme', next);
    setTheme(next);
  }

  return <>
    <header className="site-header"><div className="site-header-inner">
      <Link className="brand" href={teacher ? '/teacher' : '/'} aria-label="校园办事猿首页">
        <span className="brand-mark" aria-hidden="true">猿</span><span>校园办事猿</span>
      </Link>
      <div className="header-actions">
        <IdentityControls />
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? '切换到深色模式' : '切换到亮色模式'} aria-pressed={theme === 'dark'}>
          <span aria-hidden="true">{theme === 'light' ? '◐' : '☼'}</span><span className="theme-label">{theme === 'light' ? '深色模式' : '亮色模式'}</span>
        </button>
        <button type="button" className="menu-toggle" onClick={() => setMenuOpen(open => !open)} aria-controls="site-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}><span aria-hidden="true">☰</span></button>
      </div>
    </div></header>
    <button type="button" className="sidebar-backdrop" data-open={menuOpen} onClick={() => setMenuOpen(false)} aria-label="关闭导航菜单" tabIndex={menuOpen ? 0 : -1} />
    <aside className="site-sidebar" data-open={menuOpen} id="site-navigation">
      <p className="sidebar-label">{teacher ? '老师工作台' : '学生服务'}</p>
      <nav className="site-nav" aria-label={teacher ? '老师导航' : '主导航'}>
        {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{link.label}</Link>)}
      </nav>
      {conversationNav && <section className="sidebar-conversations" aria-label="我的对话">
        <div className="sidebar-conversations-heading"><h2>我的对话</h2><button type="button" className="button-secondary" disabled={!conversationNav.authenticated || conversationNav.loading || conversationNav.creating || conversationNav.disabled} onClick={() => { conversationNav.onCreate(); setMenuOpen(false); }}>{conversationNav.creating ? '新建中…' : '＋ 新对话'}</button></div>
        {conversationNav.createError && <p role="alert" className="sidebar-conversations-error">新建失败：{conversationNav.createError}</p>}
        {conversationNav.loading && <p className="sidebar-conversations-note" role="status">正在加载…</p>}
        {conversationNav.error && <div className="sidebar-conversations-error" role="alert">{conversationNav.error}<button type="button" onClick={conversationNav.onRetry}>重试列表</button></div>}
        {!conversationNav.loading && !conversationNav.error && conversationNav.authenticated && !conversationNav.conversations.length && <p className="sidebar-conversations-note">暂无对话</p>}
        <div className="sidebar-conversations-list" role="group" aria-label="历史对话">
          {conversationNav.conversations.map(conversation => <button key={conversation.id} type="button" className="sidebar-conversation" aria-current={conversation.id === conversationNav.activeId ? 'true' : undefined}
            disabled={conversationNav.disabled || conversationNav.creating} title={conversation.title} onClick={() => { conversationNav.onSelect(conversation.id); setMenuOpen(false); }}>
            <span>{conversation.title}</span><time dateTime={conversation.updated_at}>{new Date(conversation.updated_at).toLocaleDateString('zh-CN')}</time>
          </button>)}
        </div>
      </section>}
    </aside>
  </>;
}
