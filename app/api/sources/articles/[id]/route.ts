import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';
import { noStore, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '编号无效' }, { status: 400, headers: noStore });
  try {
    const db = getSupabase();
    const [article, history] = await Promise.all([
      db.from('source_articles').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle(),
      db.from('source_article_versions').select('revision,source_text,content_hash,fetched_at').eq('article_id', id).eq('owner_id', user.id).order('revision', { ascending: false }).limit(1),
    ]);
    if (article.error || history.error) throw new Error('db_failed');
    if (!article.data) return NextResponse.json({ error: '文章不存在' }, { status: 404, headers: noStore });
    return NextResponse.json({ article: article.data, previous: history.data?.[0] || null }, { headers: noStore });
  } catch { return NextResponse.json({ error: '文章暂时不可用' }, { status: 503, headers: noStore }); }
}
