import { NextResponse } from 'next/server';
import { extractEventModel } from '@/lib/llm';
import { parseEventExtraction } from '@/lib/event-extraction';
import { fetchNotice, FETCH_FAILURE, FETCH_TOO_LONG, FETCH_UNSUPPORTED } from '@/lib/safe-fetch';
import { getCurrentUser } from '@/lib/auth';
import { unauthorized } from '@/lib/teacher-api';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400, headers }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '请求格式无效' }, { status: 400, headers });
  const data = input as Record<string, unknown>;
  const hasUrl = typeof data.url === 'string' && !!data.url.trim();
  const hasText = typeof data.text === 'string' && !!data.text.trim();
  const hasArticle = typeof data.article_id === 'string' && UUID_RE.test(data.article_id);
  if (Number(hasUrl) + Number(hasText) + Number(hasArticle) !== 1) return NextResponse.json({ error: '请选择文章、链接或粘贴文本其中一种' }, { status: 400, headers });
  const providedDate = typeof data.publish_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.publish_date) ? data.publish_date : null;
  let publishDate = providedDate;
  let dateSource: 'user' | 'page' | 'unknown' = providedDate ? 'user' : 'unknown';
  let fetchedAt: string | null = null;
  let sourceText: string;
  let sourceUrl: string | null = null;
  if (hasArticle) {
    try {
      const article = await getSupabase().from('source_articles').select('url,source_text,published_date,fetched_at,completeness').eq('id', data.article_id).eq('owner_id', user.id).maybeSingle();
      if (article.error) throw article.error;
      if (!article.data) return NextResponse.json({ error: '文章不存在' }, { status: 404, headers });
      if (article.data.completeness !== 'complete') return NextResponse.json({ error: '文章原文不完整，不能据此整理事项' }, { status: 422, headers });
      sourceText = article.data.source_text; sourceUrl = article.data.url; fetchedAt = article.data.fetched_at;
      if (!providedDate && article.data.published_date) { publishDate = article.data.published_date; dateSource = 'page'; }
    } catch { return NextResponse.json({ error: '文章暂时不可用' }, { status: 503, headers }); }
  } else if (hasUrl) {
    const allowed = (process.env.ALLOWED_FETCH_DOMAINS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
    try {
      const fetched = await fetchNotice((data.url as string).trim(), allowed);
      sourceText = fetched.sourceText;
      sourceUrl = fetched.sourceUrl;
      fetchedAt = fetched.fetchedAt;
      if (!providedDate && fetched.publishedDate) { publishDate = fetched.publishedDate; dateSource = 'page'; }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      return NextResponse.json({ error: reason === FETCH_TOO_LONG || reason === FETCH_UNSUPPORTED ? reason : FETCH_FAILURE, error_type: reason === FETCH_TOO_LONG ? 'incomplete_content' : 'fetch_failed' }, { status: 422, headers });
    }
  } else {
    sourceText = (data.text as string).trim();
    if (sourceText.length < 20 || sourceText.length > 20000) return NextResponse.json({ error: '通知正文需为20到20000字' }, { status: 400, headers });
  }
  try {
    // 模型偶尔返回空白或不完整 JSON；仅对这两种情况重试一次。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await extractEventModel(sourceText, publishDate);
        return NextResponse.json({ draft: parseEventExtraction(raw, sourceText, publishDate, sourceUrl), source: { published_date: publishDate, publish_date_source: dateSource, fetched_at: fetchedAt, completeness: 'complete' } }, { headers });
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        if (attempt === 0 && (reason === 'model_response_failed' || reason === 'invalid_extraction')) continue;
        throw error;
      }
    }
  } catch {
    return NextResponse.json({ error: '提取服务暂时不可用，请稍后重试', error_type: 'extract_failed' }, { status: 503, headers });
  }
}
