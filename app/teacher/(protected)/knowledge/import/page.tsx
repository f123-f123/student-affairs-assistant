import Link from 'next/link';
import SiteHeader from '@/app/components/SiteHeader';
import OfficialKnowledgeImport from '@/app/components/OfficialKnowledgeImport';

export default function ImportKnowledgePage() {
  return <div className="app-shell"><SiteHeader teacher /><main className="page-content space-y-5"><Link href="/teacher/knowledge">← 返回知识库</Link><h1 className="page-title">从官网导入知识</h1><OfficialKnowledgeImport /></main></div>;
}
