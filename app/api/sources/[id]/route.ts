import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { allowedDomains } from '@/lib/information-sources';
import { validateFetchTarget } from '@/lib/safe-fetch';
import { UUID_RE } from '@/lib/validation';
import { noStore, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function PATCH(request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('编号无效');
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  const kind = input?.kind;
  if (!name || name.length > 100 || url.length > 2000 || (kind !== 'article' && kind !== 'column')) return error('信息源内容无效');
  try { await validateFetchTarget(url, allowedDomains()); } catch { return error('网址不在允许的公开域名内，或解析不安全'); }
  try {
    const db = getSupabase();
    const previous = await db.from('information_sources').select('url,kind').eq('id', id).eq('owner_id', user.id).maybeSingle();
    if (previous.error) throw previous.error;
    if (!previous.data) return error('信息源不存在', 404);
    const result = await db.from('information_sources').update({ name, url, kind, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id).select('id');
    if (result.error) throw result.error;
    if (!result.data?.length) return error('信息源不存在', 404);
    if (previous.data.url !== url || previous.data.kind !== kind) {
      const cleared = await db.from('source_links').delete().eq('source_id', id).eq('owner_id', user.id);
      if (cleared.error) throw cleared.error;
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch { return error('更新失败', 503); }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('编号无效');
  try {
    const result = await getSupabase().from('information_sources').delete().eq('id', id).eq('owner_id', user.id).select('id');
    if (result.error) throw result.error;
    if (!result.data?.length) return error('信息源不存在', 404);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch { return error('删除失败', 503); }
}
