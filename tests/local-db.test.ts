import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLocalDb, migrateArticleMetadata, migrateChatLogs, migrateEventSourceColumns, migrateLegacyKnowledgeStatus } from '../lib/local-db';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });

describe('本机 SQLite 演示数据', () => {
  it('旧文章约束增量升级保留文章、历史版本及引用，附件状态不伪造为完整', () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const raw = new DatabaseSync(':memory:');
    const schema = readFileSync(join(process.cwd(), 'local/schema.sql'), 'utf8');
    const legacy = schema.replace("completeness IN ('complete','body_only')", "completeness = 'complete'")
      .replace("  attachments TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments) AND json_type(attachments) = 'array'),\n", '')
      .replace("  attachments TEXT NOT NULL DEFAULT '[]', completeness TEXT NOT NULL DEFAULT 'legacy_unknown', UNIQUE(article_id,revision)", '  UNIQUE(article_id,revision)');
    try {
      raw.exec(legacy);
      raw.exec("INSERT INTO information_sources(id,owner_id,name,url,kind) VALUES ('source','owner','通知','https://school.example','article')");
      raw.exec("INSERT INTO source_articles(id,source_id,owner_id,url,title,source_text,fetched_at,content_hash,completeness) VALUES ('article','source','owner','https://school.example','旧通知','旧正文','2026-10-01','hash','complete')");
      raw.exec("INSERT INTO source_article_versions(id,article_id,owner_id,revision,source_text,content_hash,fetched_at) VALUES ('version','article','owner',1,'旧历史','hash','2026-09-01')");
      migrateArticleMetadata(raw, schema); migrateArticleMetadata(raw, schema);
      expect(raw.prepare('SELECT id,source_text,completeness,attachments FROM source_articles').get()).toEqual({ id: 'article', source_text: '旧正文', completeness: 'complete', attachments: '[]' });
      expect(raw.prepare('SELECT article_id,source_text,completeness FROM source_article_versions').get()).toEqual({ article_id: 'article', source_text: '旧历史', completeness: 'legacy_unknown' });
      raw.exec("UPDATE source_articles SET completeness='body_only' WHERE id='article'");
      expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { raw.close(); }
  });
  it('历史知识快照保留有效期、来源关联和数组别名', async () => {
    const db = getLocalDb();
    const old = await db.from('knowledge_items').insert({ category_id: '10000000-0000-4000-8000-000000000008',
      question: '历史快照测试', answer: '旧答案', source_level: 1, source_name: '原始出处', aliases: ['别名'],
      valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z', origin_event_id: 'origin-event', status: 'draft' }).select('id,version').single();
    const { id, version } = old.data as { id: string; version: number };
    await db.from('knowledge_items').update({ answer: '新答案' }).eq('id', id);
    const archived = await db.from('knowledge_item_versions').select('snapshot').eq('item_id', id).eq('version', version).single();
    expect(archived.error).toBeNull();
    expect(archived.data).toMatchObject({ snapshot: { aliases: ['别名'], valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-11-01T00:00:00Z', origin_event_id: 'origin-event', answer: '旧答案', source_level: 1 } });
  });
  it('精确计数不受 limit 影响，关联字段放在中间仍能正确投影', async () => {
    const db = getLocalDb();
    const total = await db.from('categories').select('id', { count: 'exact', head: true });
    const limited = await db.from('categories').select('id', { count: 'exact' }).limit(1);
    expect(total.error).toBeNull();
    expect(total.data).toBeNull();
    expect(total.count).toBeGreaterThan(1);
    expect(limited.count).toBe(total.count);
    expect(limited.data).toHaveLength(1);
    const joined = await db.from('knowledge_items').select('id,categories(name),question').limit(1).single();
    expect(joined.error).toBeNull();
    expect(joined.data).toMatchObject({ id: expect.any(String), question: expect.any(String), categories: { name: expect.any(String) } });
  });
  it('已有事项原位补来源字段，重复执行保留旧内容', () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const raw = new DatabaseSync(':memory:');
    try {
      raw.exec('CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
      raw.prepare('INSERT INTO events(id,title) VALUES (?,?)').run('old-event', '历史事项');
      migrateEventSourceColumns(raw); migrateEventSourceColumns(raw);
      expect(raw.prepare('SELECT id,title,source_article_id,source_confirmed_at FROM events').get()).toEqual({ id: 'old-event', title: '历史事项', source_article_id: null, source_confirmed_at: null });
    } finally { raw.close(); }
  });
  it('旧 SQLite 状态约束增量升级后保留原 ID 与引用', () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const raw = new DatabaseSync(':memory:');
    const schema = readFileSync(join(process.cwd(), 'local', 'schema.sql'), 'utf8');
    const legacy = schema.replace("'draft', 'confirmed', 'superseded', 'inactive'", "'draft', 'confirmed', 'superseded'");
    try {
      raw.exec(legacy);
      raw.prepare('INSERT INTO categories(id,name,description) VALUES (?,?,?)').run('category', '测试', '测试');
      raw.prepare('INSERT INTO knowledge_items(id,category_id,question,answer,source_level,source_name,status) VALUES (?,?,?,?,?,?,?)')
        .run('item', 'category', '旧问题', '旧答案', 1, '旧来源', 'confirmed');
      migrateLegacyKnowledgeStatus(raw, schema);
      raw.prepare("UPDATE knowledge_items SET status = 'inactive' WHERE id = 'item'").run();
      expect(raw.prepare("SELECT id,status FROM knowledge_items WHERE id='item'").get()).toEqual({ id: 'item', status: 'inactive' });
      expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { raw.close(); }
  });
  it('草稿发布后可见，旧版本保留，停用后不再参与', async () => {
    const db = getLocalDb();
    const categoryId = '10000000-0000-4000-8000-000000000008';
    const created = await db.from('knowledge_items').insert({ category_id: categoryId, question: '测试知识', answer: '旧答案',
      source_level: 1, source_name: '测试依据', status: 'draft' }).select('id').single();
    const id = (created.data as { id: string }).id;
    expect((await db.from('knowledge_items').select('id').eq('id', id).eq('status', 'confirmed')).data).toEqual([]);
    await db.from('knowledge_items').update({ answer: '新答案' }).eq('id', id);
    const stale = await db.rpc('publish_knowledge_item', { p_id: id, p_expected_version: 0 });
    expect(stale.error?.message).toContain('version_conflict');
    const current = await db.from('knowledge_items').select('version').eq('id', id).single();
    const published = await db.rpc('publish_knowledge_item', { p_id: id, p_expected_version: (current.data as { version: number }).version });
    expect(published.error).toBeNull();
    const active = await db.from('knowledge_items').select('version,status').eq('id', id).single();
    expect((active.data as { status: string }).status).toBe('confirmed');
    expect((active.data as { version: number }).version).toBeGreaterThan(1);
    const versions = await db.from('knowledge_item_versions').select('version,snapshot').eq('item_id', id);
    expect((versions.data as unknown[]).length).toBeGreaterThan(0);
    await db.from('knowledge_items').update({ status: 'inactive' }).eq('id', id);
    expect((await db.from('knowledge_items').select('id').eq('id', id).eq('status', 'confirmed')).data).toEqual([]);
  });
  it('未来生效的替换草稿审核后不立即停用现行知识', async () => {
    const db = getLocalDb();
    const categoryId = '10000000-0000-4000-8000-000000000008';
    const old = await db.from('knowledge_items').insert({ category_id: categoryId, question: '未来替换测试', answer: '现行办法',
      source_level: 1, source_name: '测试依据', status: 'confirmed' }).select('id').single();
    const oldId = (old.data as { id: string }).id;
    const draft = await db.from('knowledge_items').insert({ category_id: categoryId, question: '未来替换测试', answer: '新办法',
      source_level: 1, source_name: '测试依据', status: 'draft', supersedes: oldId, valid_from: '2099-01-01T00:00:00Z' }).select('id,version').single();
    const { id, version } = draft.data as { id: string; version: number };
    expect((await db.rpc('publish_knowledge_item', { p_id: id, p_expected_version: version })).error).toBeNull();
    expect((await db.from('knowledge_items').select('status').eq('id', oldId).single()).data).toMatchObject({ status: 'confirmed' });
    expect((await db.from('knowledge_items').select('status').eq('id', id).single()).data).toMatchObject({ status: 'confirmed' });
  });
  it('导入虚构条目，并只读取 confirmed', async () => {
    const db = getLocalDb();
    const result = await db.from('knowledge_items').select('id,question,status,categories(name)')
      .eq('status', 'confirmed');
    expect(result.error).toBeNull();
    const items = result.data as { question: string; categories: { name: string } }[];
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.find(item => item.question.includes('在读证明'))?.categories.name).toBe('证明开具');
    expect(items.some(item => item.question.includes('缓考申请流程'))).toBe(false);
  });

  it('确认入库是事务，重复点击只产生一条知识', async () => {
    const db = getLocalDb();
    const deviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const categoryId = '10000000-0000-4000-8000-000000000008';
    const ticket = await db.from('tickets').insert({ device_id: deviceId, question: '缓考怎么申请？', category_id: categoryId })
      .select('id').single();
    const id = (ticket.data as { id: string }).id;
    await db.from('tickets').update({ status: 'answered', teacher_reply: '联系教务老师。' }).eq('id', id);
    const params = { p_ticket_id: id, p_question: '缓考怎么申请？', p_answer: '联系教务老师。', p_category_id: categoryId, p_supersedes: null };
    const first = await db.rpc('confirm_ticket_knowledge', params);
    const second = await db.rpc('confirm_ticket_knowledge', params);
    expect(first.error).toBeNull();
    expect(second.error?.message).toBe('already_sedimented');
    const found = await db.from('knowledge_items').select('id').eq('id', first.data);
    expect((found.data as unknown[]).length).toBe(1);
  });

  it('问答快照写入数据库后可按当前对话读取', async () => {
    const db = getLocalDb();
    const deviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const conversation = await db.from('conversations').insert({ device_id: deviceId }).select('id').single();
    const conversationId = (conversation.data as { id: string }).id;
    const response = { answerable: false, citations: [], contacts: [], category_id: '10000000-0000-4000-8000-000000000008' };
    const written = await db.from('chat_logs').insert({ device_id: deviceId, conversation_id: conversationId, question: '缓考怎么申请？', answerable: false, cited_item_ids: [], response_json: response });
    expect(written.error).toBeNull();
    const found = await db.from('chat_logs').select('question,response_json').eq('device_id', deviceId).eq('conversation_id', conversationId).limit(50);
    expect(found.data).toEqual([{ question: '缓考怎么申请？', response_json: response }]);
  });

  it('同一设备的多个对话各自保存问答', async () => {
    const db = getLocalDb();
    const deviceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const first = await db.from('conversations').insert({ device_id: deviceId, title: '奖学金' }).select('id').single();
    const second = await db.from('conversations').insert({ device_id: deviceId, title: '宿舍' }).select('id').single();
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const firstId = (first.data as { id: string }).id;
    const secondId = (second.data as { id: string }).id;
    await db.from('chat_logs').insert({ device_id: deviceId, conversation_id: firstId, question: '奖学金条件？', answerable: false, cited_item_ids: [] });
    await db.from('chat_logs').insert({ device_id: deviceId, conversation_id: secondId, question: '宿舍报修？', answerable: false, cited_item_ids: [] });
    const firstHistory = await db.from('chat_logs').select('question').eq('device_id', deviceId).eq('conversation_id', firstId);
    const secondHistory = await db.from('chat_logs').select('question').eq('device_id', deviceId).eq('conversation_id', secondId);
    expect(firstHistory.data).toEqual([{ question: '奖学金条件？' }]);
    expect(secondHistory.data).toEqual([{ question: '宿舍报修？' }]);
  });

  it('旧 SQLite 问答迁入历史对话，重复迁移不丢记录', () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const raw = new DatabaseSync(':memory:');
    const deviceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    try {
      raw.exec(`CREATE TABLE chat_logs (
        id TEXT PRIMARY KEY, device_id TEXT, question TEXT NOT NULL, answerable INTEGER NOT NULL,
        category_id TEXT, cited_item_ids TEXT NOT NULL DEFAULT '[]', error_type TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
      raw.prepare('INSERT INTO chat_logs (id,device_id,question,answerable) VALUES (?,?,?,?)')
        .run('legacy-log', deviceId, '旧问题', 0);
      raw.exec(readFileSync(join(process.cwd(), 'local', 'schema.sql'), 'utf8'));
      migrateChatLogs(raw);
      migrateChatLogs(raw);
      const conversations = raw.prepare('SELECT id,title,device_id FROM conversations').all() as { id: string; title: string; device_id: string }[];
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({ title: '历史对话', device_id: deviceId });
      expect(raw.prepare('SELECT question,conversation_id FROM chat_logs').all()).toEqual([
        { question: '旧问题', conversation_id: conversations[0].id },
      ]);
    } finally { raw.close(); }
  });
});
