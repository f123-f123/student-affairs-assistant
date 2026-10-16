import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { allowedDomains } from '@/lib/information-sources';
import { validateFetchTarget } from '@/lib/safe-fetch';
import { unauthorized, noStore } from '@/lib/teacher-api';
import { databaseFailure } from '@/lib/database-failure';
import { attachmentSchemaMissing, sourceFailure } from '@/lib/source-errors';

export const dynamic = 'force-dynamic';
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    const db = getSupabase();
    const [sources, articles, links] = await Promise.all([
      db.from('information_sources').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }),
      db.from('source_articles').select('id,source_id,url,title,published_date,fetched_at,content_hash,completeness,attachments,revision').eq('owner_id', user.id).order('fetched_at', { ascending: false }).limit(100),
      db.from('source_links').select('id,source_id,url,title,discovered_at').eq('owner_id', user.id).order('discovered_at', { ascending: false }).limit(50),
    ]);
    if (sources.error || articles.error || links.error) throw sources.error || articles.error || links.error;
    return NextResponse.json({ sources: sources.data, articles: articles.data, links: links.data }, { headers: noStore });
  } catch (cause) { return attachmentSchemaMissing(cause) ? sourceFailure(cause) : databaseFailure('sources.list', cause); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  const kind = input?.kind;
  if (!name || name.length > 100 || url.length > 2000 || (kind !== 'article' && kind !== 'column')) return error('信息源内容无效');
  try { await validateFetchTarget(url, allowedDomains()); } catch (cause) { return sourceFailure(cause); }
  try {
    const db = getSupabase();
    const existing = await db.from('information_sources').select('id').eq('owner_id', user.id);
    if (existing.error) throw existing.error;
    if ((existing.data?.length || 0) >= 5) return error('最多保存5个信息源', 409);
    const result = await db.from('information_sources').insert({ owner_id: user.id, name, url, kind }).select('id').single();
    if (result.error) {
      const duplicate = result.error.message.includes('UNIQUE') || result.error.code === '23505';
      const limit = result.error.message.includes('source_limit');
      return error(limit ? '最多保存5个信息源' : duplicate ? '该信息源已保存' : '保存失败', limit || duplicate ? 409 : 503);
    }
    return NextResponse.json({ id: result.data.id }, { status: 201, headers: noStore });
  } catch { return error('保存失败', 503); }
}
