import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { allowedDomains } from '@/lib/information-sources';
import { fetchNotice } from '@/lib/safe-fetch';
import { saveSourceArticle } from '@/lib/source-storage';
import { UUID_RE } from '@/lib/validation';
import { noStore, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function POST(request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('编号无效');
  let input: { urls?: unknown };
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 5 || !input.urls.every(url => typeof url === 'string')) return error('每次最多获取5篇文章');
  const db = getSupabase();
  const source = await db.from('information_sources').select('id,kind').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (source.error) return error('获取失败', 503);
  if (!source.data || source.data.kind !== 'column') return error('栏目不存在', 404);
  const results: { url: string; status: string; title?: string; error?: string }[] = [];
  const urls = [...new Set(input.urls as string[])];
  for (let index = 0; index < urls.length; index += 2) {
    const batch = await Promise.all(urls.slice(index, index + 2).map(async url => {
      try {
        const link = await db.from('source_links').select('id').eq('source_id', id).eq('owner_id', user.id).eq('url', url).maybeSingle();
        if (link.error || !link.data) throw new Error('请先检查栏目并从列表选择文章');
        const fetched = await fetchNotice(url, allowedDomains());
        const result = await saveSourceArticle(user.id, id, fetched);
        return { url, status: result.status, title: result.title };
      } catch (cause) { return { url, status: 'failed', error: cause instanceof Error ? cause.message : '获取失败' }; }
    }));
    results.push(...batch);
  }
  return NextResponse.json({ results }, { headers: noStore });
}
