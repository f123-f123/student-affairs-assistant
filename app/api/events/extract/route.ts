import { NextResponse } from 'next/server';
import { extractEventModel } from '@/lib/llm';
import { parseEventExtraction } from '@/lib/event-extraction';
import { shanghaiToday } from '@/lib/event-date';
import { fetchNotice, FETCH_FAILURE } from '@/lib/safe-fetch';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400, headers }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ error: '请求格式无效' }, { status: 400, headers });
  const data = input as Record<string, unknown>;
  const hasUrl = typeof data.url === 'string' && !!data.url.trim();
  const hasText = typeof data.text === 'string' && !!data.text.trim();
  if (hasUrl === hasText) return NextResponse.json({ error: '请选择链接或粘贴文本其中一种' }, { status: 400, headers });
  const publishDate = typeof data.publish_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.publish_date) ? data.publish_date : shanghaiToday();
  let sourceText: string;
  let sourceUrl: string | null = null;
  if (hasUrl) {
    const allowed = (process.env.ALLOWED_FETCH_DOMAINS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
    try {
      const fetched = await fetchNotice((data.url as string).trim(), allowed);
      sourceText = fetched.sourceText;
      sourceUrl = fetched.sourceUrl;
    } catch { return NextResponse.json({ error: FETCH_FAILURE, error_type: 'fetch_failed' }, { status: 422, headers }); }
  } else {
    sourceText = (data.text as string).trim();
    if (sourceText.length < 20 || sourceText.length > 20000) return NextResponse.json({ error: '通知正文需为20到20000字' }, { status: 400, headers });
  }
  try {
    // 模型偶尔返回空白或不完整 JSON；仅对这两种情况重试一次。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await extractEventModel(sourceText, publishDate);
        return NextResponse.json({ draft: parseEventExtraction(raw, sourceText, publishDate, sourceUrl) }, { headers });
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
