// 显式启用的共享库只读部署核查；不调用 RPC，不输出任何工单正文或个人信息。
import { it, vi } from 'vitest';
import { loadEnvConfig } from '@next/env';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../lib/supabase';
import { replyVersion } from '../lib/ticket-contract';

it.skipIf(process.env.VERIFY_TICKET_CONTRACT_SHARED !== '1')('共享工单版本及RPC目录只读核对', async () => {
  vi.stubEnv('NODE_ENV', 'development'); loadEnvConfig(process.cwd(), true);
  if (process.env.DB_PROVIDER !== 'supabase') throw new Error('Expected configured Supabase, no fallback');
  const db = getSupabase();
  const tickets = await db.from('tickets').select('reply_version,knowledge_item_id').order('created_at', { ascending: false }).limit(100);
  if (tickets.error) throw new Error(`Read-only tickets check failed: ${tickets.error.code}`);
  const url = process.env.SUPABASE_URL!;
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
  const catalog = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(20000) });
  if (!catalog.ok) throw new Error(`Read-only API catalog failed: HTTP ${catalog.status}`);
  const schema = await catalog.json();
  const ids = [...new Set((tickets.data || []).map(t => t.knowledge_item_id).filter((id): id is string => typeof id === 'string'))];
  const linked = ids.length ? await db.from('knowledge_items').select('id,source_excerpt').in('id', ids) : { data: [], error: null };
  if (linked.error) throw new Error(`Read-only linked knowledge check failed: ${linked.error.code}`);
  const report = { checked_at: new Date().toISOString(), database: new URL(url).hostname.split('.')[0], shared_writes: 0,
    reply_version_column_exists: true, sampled_tickets: tickets.data!.length, all_sampled_versions_valid: tickets.data!.every(t => replyVersion(t.reply_version)),
    sampled_zero_versions: tickets.data!.filter(t => t.reply_version === 0).length,
    legacy_checked_rpc_in_catalog: !!schema.paths?.['/rpc/confirm_ticket_knowledge_checked'],
    safe_public_rpc_in_catalog: !!schema.paths?.['/rpc/confirm_ticket_knowledge_public_checked'],
    linked_items_sampled: linked.data!.length,
    linked_items_with_nonempty_excerpt_to_review: linked.data!.filter(k => typeof k.source_excerpt === 'string' && k.source_excerpt.trim()).map(k => k.id),
    note: 'Only latest 100 tickets sampled. No raw reply read or RPC executed. Historical versions/chat snapshots require the supplied read-only SQL audit.' };
  writeFileSync('artifacts/ticket-contract-20261019-shared.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}, 40000);
