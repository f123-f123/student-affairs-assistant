import { NextResponse } from 'next/server';
import { extractEventModel } from '@/lib/llm';
import { parseEventExtraction } from '@/lib/event-extraction';
import { fetchNotice } from '@/lib/safe-fetch';
import { attachmentSchemaMissing, sourceFailure } from '@/lib/source-errors';
import type { NoticeAttachment } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { unauthorized } from '@/lib/teacher-api';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, isDateOnly } from '@/lib/validation';
import { allowedDomains } from '@/lib/information-sources';

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
  const providedDate = data.publish_date == null || data.publish_date === '' ? null : data.publish_date;
  if (providedDate !== null && !isDateOnly(providedDate)) {
    return NextResponse.json({ error: '发布日期无效' }, { status: 400, headers });
  }
  let publishDate = providedDate;
  let dateSource: 'user' | 'page' | 'unknown' = providedDate ? 'user' : 'unknown';
  let fetchedAt: string | null = null;
  let sourceText: string;
  let sourceUrl: string | null = null;
  let attachments: NoticeAttachment[] = [];
  let completeness = hasText ? 'manual_text' : 'body_only';
  if (hasArticle) {
    try {
      const article = await getSupabase().from('source_articles').select('url,source_text,published_date,fetched_at,completeness,attachments').eq('id', data.article_id).eq('owner_id', user.id).maybeSingle();
      if (article.error) throw article.error;
      if (!article.data) return NextResponse.json({ error: '文章不存在' }, { status: 404, headers });
      if (!['complete', 'body_only'].includes(article.data.completeness)) return NextResponse.json({ error: '网页正文不完整，不能据此整理事项' }, { status: 422, headers });
      completeness = article.data.completeness === 'complete' ? 'legacy_unknown' : 'body_only';
      attachments = article.data.attachments ?? [];
      sourceText = article.data.source_text; sourceUrl = article.data.url; fetchedAt = article.data.fetched_at;
      if (!providedDate && article.data.published_date) { publishDate = article.data.published_date; dateSource = 'page'; }
    } catch (cause) { return attachmentSchemaMissing(cause) ? sourceFailure(cause) : NextResponse.json({ error: '文章暂时不可用' }, { status: 503, headers }); }
  } else if (hasUrl) {
    try {
      const fetched = await fetchNotice((data.url as string).trim(), allowedDomains());
      sourceText = fetched.sourceText;
      sourceUrl = fetched.sourceUrl;
      fetchedAt = fetched.fetchedAt;
      attachments = fetched.attachments;
      if (!providedDate && fetched.publishedDate) { publishDate = fetched.publishedDate; dateSource = 'page'; }
    } catch (error) { return sourceFailure(error); }
  } else {
    sourceText = (data.text as string).trim();
    if (sourceText.length < 20 || sourceText.length > 20000) return NextResponse.json({ error: '通知正文需为20到20000字' }, { status: 400, headers });
  }
  const source = { published_date: publishDate, publish_date_source: dateSource, fetched_at: fetchedAt, completeness, attachments,
    warning: hasText ? '仅依据粘贴的文本整理，通知资料完整性未核验。' : '仅依据网页正文整理；附件尚未解析，整份通知资料完整性未核验，请打开附件人工核对。' };
  try {
    // 模型偶尔返回空白或不完整 JSON；仅对这两种情况重试一次。
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await extractEventModel(sourceText, publishDate);
        return NextResponse.json({ draft: parseEventExtraction(raw, sourceText, publishDate, sourceUrl), source }, { headers });
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        if (attempt === 0 && (reason === 'model_response_failed' || reason === 'invalid_extraction')) continue;
        throw error;
      }
    }
  } catch {
    return NextResponse.json({ error: '提取服务暂时不可用，请稍后重试', error_type: 'extract_failed', source }, { status: 503, headers });
  }
}
