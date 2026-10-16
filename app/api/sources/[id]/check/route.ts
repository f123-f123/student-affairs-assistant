import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { allowedDomains, parseColumnLinks } from '@/lib/information-sources';
import { fetchNotice, fetchValidatedHtml } from '@/lib/safe-fetch';
import { saveSourceArticle } from '@/lib/source-storage';
import { UUID_RE } from '@/lib/validation';
import { noStore, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function POST(_request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('编号无效');
  const db = getSupabase();
  const source = await db.from('information_sources').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (source.error) return error('检查失败', 503);
  if (!source.data) return error('信息源不存在', 404);
  try {
    let results: { url: string; title: string; status: string }[];
    if (source.data.kind === 'article') {
      const article = await fetchNotice(source.data.url, allowedDomains());
      const result = await saveSourceArticle(user.id, id, article);
      results = [{ url: article.sourceUrl, title: result.title, status: result.status }];
    } else {
      const page = await fetchValidatedHtml(source.data.url, allowedDomains());
      const links = parseColumnLinks(page.html, page.sourceUrl);
      if (!links.length) return error('栏目未找到可识别的文章列表；动态页面暂不支持', 422);
      results = [];
      for (const link of links) {
        const existing = await db.from('source_links').select('id').eq('source_id', id).eq('owner_id', user.id).eq('url', link.url).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) results.push({ ...link, status: 'known' });
        else {
          const saved = await db.from('source_links').insert({ source_id: id, owner_id: user.id, url: link.url, title: link.title, discovered_at: page.fetchedAt });
          if (saved.error) throw saved.error;
          results.push({ ...link, status: 'new' });
        }
      }
    }
    await db.from('information_sources').update({ last_checked_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id);
    return NextResponse.json({ results }, { headers: noStore });
  } catch (cause) { return error(cause instanceof Error ? cause.message : '检查失败', 422); }
}
