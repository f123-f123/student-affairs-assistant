import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';

// 运行时从 Node 内置模块取 SQLite，避免测试打包器误将其当成 npm 包。
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Filter = { column: string; operator: string; value: unknown };
const tables = new Set(['categories', 'contacts', 'knowledge_items', 'tickets', 'conversations', 'chat_logs', 'teacher_login_attempts', 'events']);
const booleanColumns = new Set(['sedimented', 'answerable', 'deadline_inferred']);
const jsonColumns = new Set(['cited_item_ids', 'materials', 'response_json']);

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('invalid_column');
  return `"${value}"`;
}

function encode(column: string, value: unknown): SQLInputValue {
  if (jsonColumns.has(column)) return JSON.stringify(value);
  if (booleanColumns.has(column)) return value ? 1 : 0;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  throw new Error('invalid_value');
}

function decode(row: Row): Row {
  const value = { ...row };
  for (const column of booleanColumns) if (column in value) value[column] = !!value[column];
  for (const column of jsonColumns) if (typeof value[column] === 'string') value[column] = JSON.parse(value[column]);
  return value;
}

class LocalQuery implements PromiseLike<Result> {
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private fields = '*';
  private head = false;
  private countRequested = false;
  private filters: Filter[] = [];
  private ordering: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private values: Row = {};
  private one: 'single' | 'maybeSingle' | null = null;
  private rowLimit: number | null = null;

  constructor(private db: DatabaseSyncType, private table: string) {
    if (!tables.has(table)) throw new Error('invalid_table');
  }

  select(fields = '*', options?: { count?: string; head?: boolean }) {
    this.fields = fields;
    this.head = options?.head === true;
    this.countRequested = options?.count === 'exact';
    return this;
  }
  eq(column: string, value: unknown) { this.filters.push({ column, operator: '=', value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, operator: '!=', value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column, operator: '>=', value }); return this; }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) throw new Error('unsupported_filter');
    this.filters.push({ column, operator: 'IS NOT NULL', value: null });
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst });
    return this;
  }
  limit(count: number) { this.rowLimit = count; return this; }
  insert(values: Row) { this.action = 'insert'; this.values = values; return this; }
  update(values: Row) { this.action = 'update'; this.values = values; return this; }
  delete() { this.action = 'delete'; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybeSingle'; return this; }

  private where(): { sql: string; args: SQLInputValue[] } {
    const args: SQLInputValue[] = [];
    const clauses = this.filters.map(({ column, operator, value }) => {
      const name = identifier(column);
      if (operator === 'IS NOT NULL') return `${name} IS NOT NULL`;
      args.push(encode(column, value));
      return `${name} ${operator} ?`;
    });
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', args };
  }

  private project(rows: Row[]): Row[] {
    const joinCategory = this.fields.includes('categories(name)');
    const names = this.fields.replace(/,?categories\(name\),?/, '').split(',').map(field => field.trim()).filter(Boolean);
    return rows.map(raw => {
      const row = decode(raw);
      const result: Row = names.includes('*') ? row : Object.fromEntries(names.map(name => [name, row[name]]));
      if (joinCategory) {
        const category = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(row.category_id as string) as Row | undefined;
        result.categories = category ? { name: category.name } : null;
      }
      return result;
    });
  }

  private execute(): Result {
    try {
      const where = this.where();
      let rows: Row[];
      if (this.action === 'select') {
        const order = this.ordering.map(({ column, ascending, nullsFirst }) => {
          const name = identifier(column);
          const nullOrder = nullsFirst === undefined ? '' : `${name} IS NULL ${nullsFirst ? 'DESC' : 'ASC'}, `;
          return `${nullOrder}${name} ${ascending ? 'ASC' : 'DESC'}`;
        }).join(', ');
        rows = this.db.prepare(`SELECT * FROM ${identifier(this.table)}${where.sql}${order ? ` ORDER BY ${order}` : ''}${this.rowLimit === null ? '' : ' LIMIT ?'}`)
          .all(...where.args, ...(this.rowLimit === null ? [] : [this.rowLimit])) as Row[];
      } else if (this.action === 'insert') {
        const value: Row = { id: randomUUID(), ...this.values };
        const columns = Object.keys(value);
        rows = this.db.prepare(`INSERT INTO ${identifier(this.table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')}) RETURNING *`)
          .all(...columns.map(column => encode(column, value[column]))) as Row[];
      } else if (this.action === 'update') {
        const columns = Object.keys(this.values);
        if (!columns.length) throw new Error('empty_update');
        rows = this.db.prepare(`UPDATE ${identifier(this.table)} SET ${columns.map(column => `${identifier(column)} = ?`).join(', ')}${where.sql} RETURNING *`)
          .all(...columns.map(column => encode(column, this.values[column])), ...where.args) as Row[];
      } else {
        rows = this.db.prepare(`DELETE FROM ${identifier(this.table)}${where.sql} RETURNING *`).all(...where.args) as Row[];
      }
      const data = this.head ? null : this.project(rows);
      if (this.one && rows.length > 1) throw new Error('multiple_rows');
      if (this.one === 'single' && !rows.length) throw new Error('no_rows');
      return { data: this.one ? (data as Row[])[0] ?? null : data, error: null, ...(this.countRequested ? { count: rows.length } : {}) };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'sqlite_failed' }, ...(this.countRequested ? { count: null } : {}) };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class LocalDb {
  constructor(private db: DatabaseSyncType) {}
  from(table: string) { return new LocalQuery(this.db, table); }

  // SQLite 单连接事务保证“确认入库”四步原子完成，重复点击返回同一错误。
  async rpc(name: string, params: Row): Promise<Result> {
    try {
      if (name === 'record_teacher_login_failure') {
        const key = params.p_key;
        if (typeof key !== 'string') throw new Error('invalid_key');
        const now = new Date().toISOString();
        const old = this.db.prepare('SELECT attempts, window_start FROM teacher_login_attempts WHERE key = ?').get(key) as Row | undefined;
        const attempts = old && Date.parse(old.window_start as string) > Date.now() - 15 * 60_000 ? Number(old.attempts) + 1 : 1;
        this.db.prepare('INSERT INTO teacher_login_attempts (key, attempts, window_start) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, window_start=excluded.window_start')
          .run(key, attempts, attempts === 1 ? now : old!.window_start as string);
        return { data: attempts, error: null };
      }
      if (name !== 'confirm_ticket_knowledge') throw new Error('unknown_rpc');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(params.p_ticket_id as string) as Row | undefined;
        if (!ticket) throw new Error('ticket_not_found');
        if (ticket.sedimented) throw new Error('already_sedimented');
        if (ticket.status !== 'answered' || !String(ticket.teacher_reply || '').trim()) throw new Error('ticket_not_answered');
        const categoryId = params.p_category_id as string;
        const category = this.db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
        if (!category) throw new Error('invalid_category');
        const previous = params.p_supersedes as string | null;
        if (previous) {
          const old = this.db.prepare('SELECT status, category_id FROM knowledge_items WHERE id = ?').get(previous) as Row | undefined;
          if (!old || old.status !== 'confirmed' || old.category_id !== categoryId) throw new Error('invalid_supersedes');
        }
        const id = randomUUID();
        this.db.prepare("INSERT INTO knowledge_items (id,category_id,question,answer,source_level,source_name,status,supersedes) VALUES (?,?,?,?,1,'老师确认回答','confirmed',?)")
          .run(id, categoryId, String(params.p_question).trim(), String(params.p_answer).trim(), previous ?? null);
        if (previous) this.db.prepare("UPDATE knowledge_items SET status = 'superseded' WHERE id = ?").run(previous);
        this.db.prepare('UPDATE tickets SET sedimented = 1, knowledge_item_id = ? WHERE id = ?').run(id, params.p_ticket_id as string);
        this.db.exec('COMMIT');
        return { data: id, error: null };
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'sqlite_failed' } };
    }
  }
}

const state = globalThis as typeof globalThis & { __studentLocalDb?: LocalDb };

export function migrateChatLogs(db: DatabaseSyncType) {
  // 旧演示数据库原位补列，保留已有工单和日志。
  const columns = db.prepare('PRAGMA table_info(chat_logs)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'response_json')) db.exec('ALTER TABLE chat_logs ADD COLUMN response_json TEXT');
  if (!columns.some(column => column.name === 'conversation_id')) db.exec('ALTER TABLE chat_logs ADD COLUMN conversation_id TEXT REFERENCES conversations(id)');
  db.exec('CREATE INDEX IF NOT EXISTS chat_logs_conversation_created_idx ON chat_logs(conversation_id, created_at DESC)');
  // 旧版本只有一条连续问答流，按设备原样归入“历史对话”。
  const legacy = db.prepare('SELECT device_id, min(created_at) AS first_at, max(created_at) AS last_at FROM chat_logs WHERE device_id IS NOT NULL AND conversation_id IS NULL GROUP BY device_id').all() as { device_id: string; first_at: string; last_at: string }[];
  if (legacy.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of legacy) {
        const id = randomUUID();
        db.prepare('INSERT INTO conversations (id, device_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, row.device_id, '历史对话', row.first_at, row.last_at);
        db.prepare('UPDATE chat_logs SET conversation_id = ? WHERE device_id = ? AND conversation_id IS NULL').run(id, row.device_id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

export function getLocalDb(): LocalDb {
  if (state.__studentLocalDb) return state.__studentLocalDb;
  const dataDirectory = join(process.cwd(), 'data');
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(process.env.LOCAL_SQLITE_PATH || join(dataDirectory, 'demo.sqlite'));
  db.exec(readFileSync(join(process.cwd(), 'local', 'schema.sql'), 'utf8'));
  migrateChatLogs(db);
  const count = db.prepare('SELECT count(*) AS n FROM categories').get() as { n: number };
  if (count.n === 0) db.exec(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'));
  state.__studentLocalDb = new LocalDb(db);
  return state.__studentLocalDb;
}
