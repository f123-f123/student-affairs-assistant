import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { allowedDomains } from '@/lib/information-sources';
import { fetchNotice } from '@/lib/safe-fetch';
import { sourceFailure } from '@/lib/source-errors';
import { badRequest, noStore, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!await getCurrentUser()) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || !('url' in input) || typeof input.url !== 'string' || input.url.length > 2000) return badRequest('网址无效');
  try {
    const article = await fetchNotice(input.url.trim(), allowedDomains());
    return NextResponse.json({ code: 'FETCH_OK', article, text_length: article.sourceText.length }, { headers: noStore });
  } catch (cause) { return sourceFailure(cause); }
}
