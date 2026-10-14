import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '学生事务智能助手',
  description: '依据已确认知识库回答高校学生事务问题',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: "try{const saved=localStorage.getItem('student-affairs-theme');document.documentElement.dataset.theme=saved==='light'||saved==='dark'?saved:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{document.documentElement.dataset.theme='light'}" }} /></head>
    <body>{children}</body>
  </html>;
}
