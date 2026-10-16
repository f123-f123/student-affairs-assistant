import { getSupabase } from './supabase';
import { contentHash } from './information-sources';

type FetchedArticle = { title: string; sourceText: string; sourceUrl: string; publishedDate: string | null; fetchedAt: string; completeness: 'complete' };

export async function saveSourceArticle(ownerId: string, sourceId: string, fetched: FetchedArticle) {
  const db = getSupabase();
  const result = await db.rpc('save_source_article', {
    p_owner_id: ownerId, p_source_id: sourceId, p_url: fetched.sourceUrl, p_title: fetched.title,
    p_source_text: fetched.sourceText, p_published_date: fetched.publishedDate,
    p_fetched_at: fetched.fetchedAt, p_content_hash: contentHash(fetched.sourceText), p_completeness: fetched.completeness,
  });
  if (result.error) throw result.error;
  return result.data as { status: 'new' | 'updated' | 'unchanged'; id: string; title: string };
}
