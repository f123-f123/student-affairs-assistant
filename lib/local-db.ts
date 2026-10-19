import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localImportRpc } from './local-imports';
import { localPublicContactRpc } from './local-public-contacts';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';

// 运行时从 Node 内置模块取 SQLite，避免测试打包器误将其当成 npm 包。
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Filter = { column: string; operator: string; value: unknown };
const tables = new Set(['categories', 'contacts', 'knowledge_items', 'knowledge_item_versions', 'tickets', 'conversations', 'chat_logs', 'teacher_login_attempts', 'events', 'information_sources', 'source_links', 'source_articles', 'source_article_versions', 'knowledge_imports', 'knowledge_import_drafts', 'knowledge_import_publications']);
const booleanColumns = new Set(['sedimented', 'answerable', 'deadline_inferred']);
const jsonColumns = new Set(['cited_item_ids', 'materials', 'response_json', 'aliases', 'snapshot', 'attachments', 'date_context', 'date_candidates', 'data', 'entries', 'result', 'facts', 'topic_context']);

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('invalid_column');
  return `"${value}"`;
}

function encode(column: string, value: unknown): SQLInputValue {
  if (column === 'scope' && value && typeof value === 'object') return JSON.stringify(value);
  if (jsonColumns.has(column)) return JSON.stringify(value);
  if (booleanColumns.has(column)) return value ? 1 : 0;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  throw new Error('invalid_value');
}

function decode(row: Row): Row {
  const value = { ...row };
  for (const column of booleanColumns) if (column in value) value[column] = !!value[column];
  for (const column of jsonColumns) if (typeof value[column] === 'string') value[column] = JSON.parse(value[column]);
  if (typeof value.scope === 'string' && value.scope.startsWith('{')) value.scope = JSON.parse(value.scope);
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
  private rowOffset = 0;

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
  in(column: string, values: unknown[]) { this.filters.push({ column, operator: 'IN', value: values }); return this; }
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
  range(from: number, to: number) { this.rowOffset = from; this.rowLimit = to - from + 1; return this; }
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
      if (operator === 'IN') {
        const values = value as unknown[];
        if (!values.length) return '0 = 1';
        args.push(...values.map(entry => encode(column, entry)));
        return `${name} IN (${values.map(() => '?').join(',')})`;
      }
      args.push(encode(column, value));
      return `${name} ${operator} ?`;
    });
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', args };
  }

  private project(rows: Row[]): Row[] {
    const joinCategory = this.fields.includes('categories(name)');
    const names = this.fields.replace('categories(name)', '').split(',').map(field => field.trim()).filter(Boolean);
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
      let count = this.countRequested && this.action === 'select'
        ? Number((this.db.prepare(`SELECT count(*) AS total FROM ${identifier(this.table)}${where.sql}`).get(...where.args) as Row).total)
        : undefined;
      if (this.head && this.action === 'select') return { data: null, error: null, ...(this.countRequested ? { count } : {}) };
      let rows: Row[];
      if (this.action === 'select') {
        const order = this.ordering.map(({ column, ascending, nullsFirst }) => {
          const name = identifier(column);
          const nullOrder = nullsFirst === undefined ? '' : `${name} IS NULL ${nullsFirst ? 'DESC' : 'ASC'}, `;
          return `${nullOrder}${name} ${ascending ? 'ASC' : 'DESC'}`;
        }).join(', ');
        rows = this.db.prepare(`SELECT * FROM ${identifier(this.table)}${where.sql}${order ? ` ORDER BY ${order}` : ''}${this.rowLimit === null ? '' : ' LIMIT ? OFFSET ?'}`)
          .all(...where.args, ...(this.rowLimit === null ? [] : [this.rowLimit, this.rowOffset])) as Row[];
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
      if (this.countRequested && this.action !== 'select') count = rows.length;
      const data = this.head ? null : this.project(rows);
      if (this.one && rows.length > 1) throw new Error('multiple_rows');
      if (this.one === 'single' && !rows.length) throw new Error('no_rows');
      return { data: this.one && data ? data[0] ?? null : data, error: null, ...(this.countRequested ? { count } : {}) };
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
      const contact = localPublicContactRpc(this.db, name, params);
      if (contact) return contact;
      const imported = localImportRpc(this.db, name, params);
      if (imported) return imported;
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
      if (name === 'publish_knowledge_item') {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const item = this.db.prepare('SELECT status,supersedes,category_id,version,valid_from FROM knowledge_items WHERE id = ?').get(params.p_id as string) as Row | undefined;
          if (!item || item.status !== 'draft') throw new Error('invalid_draft');
          if (!Number.isInteger(params.p_expected_version) || item.version !== params.p_expected_version) throw new Error('version_conflict');
          if (item.supersedes) {
            const old = this.db.prepare('SELECT status,category_id FROM knowledge_items WHERE id = ?').get(item.supersedes as string) as Row | undefined;
            if (!old || old.status !== 'confirmed' || old.category_id !== item.category_id) throw new Error('invalid_supersedes');
            if (!item.valid_from || Date.parse(item.valid_from as string) <= Date.now())
              this.db.prepare("UPDATE knowledge_items SET status = 'superseded' WHERE id = ?").run(item.supersedes as string);
          }
          this.db.prepare("UPDATE knowledge_items SET status = 'confirmed', reviewed_at = ?, reviewed_by = NULL WHERE id = ?").run(new Date().toISOString(), params.p_id as string);
          this.db.exec('COMMIT');
          return { data: null, error: null };
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      if (name === 'save_source_article') {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const ownerId = params.p_owner_id as string;
          const sourceId = params.p_source_id as string;
          const source = this.db.prepare('SELECT id FROM information_sources WHERE id = ? AND owner_id = ?').get(sourceId, ownerId);
          if (!source) throw new Error('source_not_found');
          const url = params.p_url as string;
          const current = this.db.prepare('SELECT * FROM source_articles WHERE source_id = ? AND url = ?').get(sourceId, url) as Row | undefined;
          let status: 'new' | 'updated' | 'unchanged';
          let id: string;
          if (current && current.content_hash === params.p_content_hash) {
            status = 'unchanged'; id = current.id as string;
          } else if (current) {
            id = current.id as string; status = 'updated';
            const archived = this.db.prepare('SELECT content_hash FROM source_article_versions WHERE article_id = ? AND revision = ?')
              .get(id, current.revision as number) as Row | undefined;
            if (archived && archived.content_hash !== current.content_hash) throw new Error('archive_conflict');
            this.db.prepare('INSERT OR IGNORE INTO source_article_versions (id,article_id,owner_id,revision,source_text,content_hash,fetched_at,attachments,completeness) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(randomUUID(), id, ownerId, current.revision as number, current.source_text as string, current.content_hash as string, current.fetched_at as string, current.attachments as string, current.completeness as string);
            this.db.prepare('UPDATE source_articles SET title=?,source_text=?,published_date=?,fetched_at=?,content_hash=?,completeness=?,attachments=?,revision=?,updated_at=? WHERE id=? AND owner_id=?')
              .run(params.p_title as string, params.p_source_text as string, params.p_published_date as string | null,
                params.p_fetched_at as string, params.p_content_hash as string, params.p_completeness as string, JSON.stringify(params.p_attachments ?? []),
                Number(current.revision) + 1, new Date().toISOString(), id, ownerId);
          } else {
            id = randomUUID(); status = 'new';
            this.db.prepare('INSERT INTO source_articles (id,source_id,owner_id,url,title,source_text,published_date,fetched_at,content_hash,completeness,attachments) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
              .run(id, sourceId, ownerId, url, params.p_title as string, params.p_source_text as string,
                params.p_published_date as string | null, params.p_fetched_at as string,
                params.p_content_hash as string, params.p_completeness as string, JSON.stringify(params.p_attachments ?? []));
          }
          const title = status === 'unchanged' ? current!.title as string : params.p_title as string;
          this.db.exec('COMMIT');
          return { data: { status, id, title }, error: null };
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      if (name !== 'confirm_ticket_knowledge' && name !== 'confirm_ticket_knowledge_checked') throw new Error('unknown_rpc');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(params.p_ticket_id as string) as Row | undefined;
        if (!ticket) throw new Error('ticket_not_found');
        if (name === 'confirm_ticket_knowledge_checked' && (ticket.reply_version !== params.p_expected_reply_version || ticket.teacher_reply !== params.p_expected_reply)) throw new Error('reply_version_conflict');
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
        this.db.prepare("INSERT INTO knowledge_items (id,category_id,question,answer,source_level,source_name,status,supersedes,reviewed_at) VALUES (?,?,?,?,1,'老师确认回答','confirmed',?,?)")
          .run(id, categoryId, String(params.p_question).trim(), String(params.p_answer).trim(), previous ?? null, new Date().toISOString());
        if (previous) this.db.prepare("UPDATE knowledge_items SET status = 'superseded' WHERE id = ?").run(previous);
        if (name === 'confirm_ticket_knowledge_checked') this.db.prepare('UPDATE knowledge_items SET reviewed_by=?,source_excerpt=? WHERE id=?').run(params.p_actor as string, ticket.teacher_reply as string, id);
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

export function migrateEventSourceColumns(db: DatabaseSyncType) {
  const columns = (db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map(column => column.name);
  for (const column of ['source_article_id', 'source_fetched_at', 'source_confirmed_at', 'publish_date_source']) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
  }
  for (const column of ['date_context', 'category_id']) if (!columns.includes(column)) db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
}

function migrateNoticeContacts(db: DatabaseSyncType) {
  const contacts = new Set((db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[]).map(column => column.name));
  if (!contacts.has('scope')) db.exec("ALTER TABLE contacts ADD COLUMN scope TEXT NOT NULL DEFAULT 'category'");
  for (const column of ['notice_event_id', 'source_excerpt', 'source_url', 'source_hash']) if (!contacts.has(column)) db.exec(`ALTER TABLE contacts ADD COLUMN ${column} TEXT`);
}

function migrateKnowledge(db: DatabaseSyncType) {
  const columns = new Set((db.prepare('PRAGMA table_info(knowledge_items)').all() as { name: string }[]).map(row => row.name));
  const additions: Record<string, string> = {
    aliases: "TEXT NOT NULL DEFAULT '[]'", source_excerpt: 'TEXT', valid_from: 'TEXT', valid_until: 'TEXT',
    version: 'INTEGER NOT NULL DEFAULT 1', reviewed_at: 'TEXT', reviewed_by: 'TEXT', origin_event_id: 'TEXT',
    scope: 'TEXT', facts: 'TEXT', import_draft_id: 'TEXT',
  };
  for (const [name, type] of Object.entries(additions)) if (!columns.has(name)) db.exec(`ALTER TABLE knowledge_items ADD COLUMN ${name} ${type}`);
  db.exec("UPDATE knowledge_items SET reviewed_at = updated_at WHERE status = 'confirmed' AND reviewed_at IS NULL");
  db.exec(`DROP TRIGGER IF EXISTS knowledge_version_archive;
    CREATE TRIGGER knowledge_version_archive AFTER UPDATE ON knowledge_items
    WHEN NEW.question IS NOT OLD.question OR NEW.answer IS NOT OLD.answer OR NEW.category_id IS NOT OLD.category_id
      OR NEW.aliases IS NOT OLD.aliases OR NEW.source_name IS NOT OLD.source_name OR NEW.source_url IS NOT OLD.source_url
      OR NEW.source_excerpt IS NOT OLD.source_excerpt OR NEW.valid_from IS NOT OLD.valid_from
      OR NEW.valid_until IS NOT OLD.valid_until OR NEW.status IS NOT OLD.status OR NEW.reviewed_at IS NOT OLD.reviewed_at
      OR NEW.reviewed_by IS NOT OLD.reviewed_by
      OR NEW.scope IS NOT OLD.scope OR NEW.facts IS NOT OLD.facts
    BEGIN
      INSERT OR IGNORE INTO knowledge_item_versions(item_id,version,snapshot)
      VALUES (OLD.id,OLD.version,json_object('id',OLD.id,'version',OLD.version,'question',OLD.question,'answer',OLD.answer,
        'category_id',OLD.category_id,'aliases',json(OLD.aliases),'source_name',OLD.source_name,'source_url',OLD.source_url,
        'source_level',OLD.source_level,'source_excerpt',OLD.source_excerpt,'valid_from',OLD.valid_from,'valid_until',OLD.valid_until,
        'supersedes',OLD.supersedes,'origin_event_id',OLD.origin_event_id,'created_at',OLD.created_at,'updated_at',OLD.updated_at,
        'status',OLD.status,'reviewed_at',OLD.reviewed_at,'reviewed_by',OLD.reviewed_by,'scope',json(OLD.scope),'facts',json(OLD.facts),'import_draft_id',OLD.import_draft_id));
      UPDATE knowledge_items SET version = OLD.version + 1 WHERE id = OLD.id;
    END`);
}

export function migrateLegacyKnowledgeStatus(db: DatabaseSyncType, schema: string) {
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knowledge_items'").get() as { sql: string };
  if (stored.sql.includes("'inactive'")) return;
  const definition = schema.match(/CREATE TABLE IF NOT EXISTS knowledge_items \([\s\S]*?\n\);/)?.[0];
  if (!definition) throw new Error('knowledge_schema_missing');
  const columns = (db.prepare('PRAGMA table_info(knowledge_items)').all() as { name: string }[]).map(row => row.name);
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(definition.replace('CREATE TABLE IF NOT EXISTS knowledge_items', 'CREATE TABLE knowledge_items_rebuild'));
    const names = columns.map(name => `"${name}"`).join(',');
    db.exec(`INSERT INTO knowledge_items_rebuild (${names}) SELECT ${names} FROM knowledge_items`);
    db.exec('DROP TABLE knowledge_items');
    db.exec('ALTER TABLE knowledge_items_rebuild RENAME TO knowledge_items');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  db.exec(schema);
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error('knowledge_migration_foreign_key_failed');
}

export function migrateArticleMetadata(db: DatabaseSyncType, schema: string) {
  const columns = (db.prepare('PRAGMA table_info(source_articles)').all() as { name: string }[]).map(row => row.name);
  if (!columns.includes('attachments')) db.exec("ALTER TABLE source_articles ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  const history = new Set((db.prepare('PRAGMA table_info(source_article_versions)').all() as { name: string }[]).map(row => row.name));
  if (!history.has('attachments')) db.exec("ALTER TABLE source_article_versions ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  if (!history.has('completeness')) db.exec("ALTER TABLE source_article_versions ADD COLUMN completeness TEXT NOT NULL DEFAULT 'legacy_unknown'");
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='source_articles'").get() as { sql: string };
  if (stored.sql.includes("'body_only'")) return;
  const definition = schema.match(/CREATE TABLE IF NOT EXISTS source_articles \([\s\S]*?\n\);/)?.[0];
  if (!definition) throw new Error('source_article_schema_missing');
  const names = [...columns.filter(name => name !== 'attachments'), 'attachments'].map(identifier).join(',');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(definition.replace('CREATE TABLE IF NOT EXISTS source_articles', 'CREATE TABLE source_articles_rebuild'));
    db.exec(`INSERT INTO source_articles_rebuild (${names}) SELECT ${names} FROM source_articles`);
    db.exec('DROP TABLE source_articles');
    db.exec('ALTER TABLE source_articles_rebuild RENAME TO source_articles');
    db.exec('COMMIT');
  } catch (cause) { db.exec('ROLLBACK'); throw cause; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  db.exec(schema);
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('source_article_migration_foreign_key_failed');
}

export function getLocalDb(): LocalDb {
  if (state.__studentLocalDb) return state.__studentLocalDb;
  const dataDirectory = join(process.cwd(), 'data');
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(process.env.LOCAL_SQLITE_PATH || join(dataDirectory, 'demo.sqlite'));
  const schema = readFileSync(join(process.cwd(), 'local', 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateEventSourceColumns(db);
  migrateNoticeContacts(db);
  const publicContactColumns = new Set((db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[]).map(row => row.name));
  for (const [name, type] of Object.entries({ notice_import_id: 'TEXT REFERENCES knowledge_imports(id)', reviewed_by: 'TEXT', reviewed_at: 'TEXT', reviewed_scope: 'TEXT', review_status: "TEXT NOT NULL DEFAULT 'pending'" })) {
    if (!publicContactColumns.has(name)) db.exec(`ALTER TABLE contacts ADD COLUMN ${identifier(name)} ${type}`);
  }
  const importColumns = new Set((db.prepare('PRAGMA table_info(knowledge_imports)').all() as { name: string }[]).map(row => row.name));
  if (!importColumns.has('contacts_version')) db.exec('ALTER TABLE knowledge_imports ADD COLUMN contacts_version INTEGER NOT NULL DEFAULT 0');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS contacts_public_identity_idx ON contacts(notice_import_id,lower(coalesce(email,'')),coalesce(phone,''),name) WHERE scope='import'");
  migrateLegacyKnowledgeStatus(db, schema);
  migrateChatLogs(db);
  const conversationColumns = (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map(row => row.name);
  if (!conversationColumns.includes('topic_context')) db.exec('ALTER TABLE conversations ADD COLUMN topic_context TEXT');
  migrateKnowledge(db);
  const ticketColumns = (db.prepare('PRAGMA table_info(tickets)').all() as { name: string }[]).map(row => row.name);
  if (!ticketColumns.includes('reply_version')) db.exec('ALTER TABLE tickets ADD COLUMN reply_version INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS knowledge_import_draft_unique ON knowledge_items(import_draft_id) WHERE import_draft_id IS NOT NULL');
  migrateArticleMetadata(db, schema);
  const count = db.prepare('SELECT count(*) AS n FROM categories').get() as { n: number };
  if (count.n === 0) db.exec(readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8'));
  state.__studentLocalDb = new LocalDb(db);
  return state.__studentLocalDb;
}
