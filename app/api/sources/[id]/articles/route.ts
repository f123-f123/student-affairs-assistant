import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { allowedDomains } from '@/lib/information-sources';
import { fetchNotice } from '@/lib/safe-fetch';
import { saveSourceArticle } from '@/lib/source-storage';
import { UUID_RE } from '@/lib/validation';
import { noStore, unauthorized } from '@/lib/teacher-api';
import { sourceError, sourceFailure } from '@/lib/source-errors';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function POST(request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('编号无效');
  let input: unknown;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error('请求格式无效');
  const values = (input as Record<string, unknown>).urls;
  if (!Array.isArray(values) || !values.length || values.length > 5 || !values.every(url => typeof url === 'string' && url.length <= 2000)) return error('每次最多获取5篇文章');
  try {
    const db = getSupabase();
    const source = await db.from('information_sources').select('id,kind').eq('id', id).eq('owner_id', user.id).maybeSingle();
    if (source.error) throw source.error;
    if (!source.data || source.data.kind !== 'column') return error('栏目不存在', 404);
    const results: { url: string; status: string; title?: string; error?: string }[] = [];
    const urls = [...new Set(values as string[])];
    const links = await db.from('source_links').select('url').eq('source_id', id).eq('owner_id', user.id).in('url', urls);
    if (links.error) throw links.error;
    const listed = new Set(links.data?.map(link => link.url));
    for (let index = 0; index < urls.length; index += 2) {
      const batch = await Promise.all(urls.slice(index, index + 2).map(async url => {
        if (!listed.has(url)) return { url, status: 'failed', error: '请先检查栏目并从列表选择文章' };
        try {
          const fetched = await fetchNotice(url, allowedDomains());
          const result = await saveSourceArticle(user.id, id, fetched);
          return { url, status: result.status, title: result.title };
        } catch (cause) {
          const failure = sourceError(cause);
          return { url, status: 'failed', error: failure.message, code: failure.code };
        }
      }));
      results.push(...batch);
    }
    return NextResponse.json({ results }, { headers: noStore });
  } catch (cause) { return sourceFailure(cause); }
}
