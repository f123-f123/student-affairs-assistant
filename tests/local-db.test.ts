import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLocalDb, migrateChatLogs } from '../lib/local-db';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });

describe('本机 SQLite 演示数据', () => {
  it('导入虚构条目，并只读取 confirmed', async () => {
    const db = getLocalDb();
    const result = await db.from('knowledge_items').select('id,question,status,categories(name)')
      .eq('status', 'confirmed');
    expect(result.error).toBeNull();
    const items = result.data as { question: string; categories: { name: string } }[];
    expect(items).toHaveLength(15);
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
