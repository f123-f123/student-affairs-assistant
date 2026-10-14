PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student_leader')),
  phone TEXT, email TEXT, office TEXT, office_hours TEXT
);
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), question TEXT NOT NULL,
  answer TEXT NOT NULL, source_level INTEGER NOT NULL CHECK (source_level BETWEEN 1 AND 3),
  source_name TEXT NOT NULL, source_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'superseded')),
  supersedes TEXT REFERENCES knowledge_items(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, question TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  teacher_reply TEXT, sedimented INTEGER NOT NULL DEFAULT 0, knowledge_item_id TEXT REFERENCES knowledge_items(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), answered_at TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS chat_logs (
  id TEXT PRIMARY KEY, device_id TEXT, conversation_id TEXT REFERENCES conversations(id), question TEXT NOT NULL, answerable INTEGER NOT NULL,
  category_id TEXT REFERENCES categories(id), cited_item_ids TEXT NOT NULL DEFAULT '[]', error_type TEXT,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS teacher_login_attempts (
  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  summary TEXT NOT NULL DEFAULT '', eligibility TEXT NOT NULL DEFAULT '', deadline TEXT,
  deadline_source_text TEXT, deadline_inferred INTEGER NOT NULL DEFAULT 0, submit_to TEXT NOT NULL DEFAULT '',
  materials TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(materials) AND json_type(materials) = 'array'),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2000),
  source_text TEXT NOT NULL CHECK (length(source_text) BETWEEN 1 AND 20000), publish_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS contacts_category_idx ON contacts(category_id);
CREATE INDEX IF NOT EXISTS knowledge_confirmed_priority_idx ON knowledge_items(source_level, updated_at DESC) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS tickets_device_created_idx ON tickets(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_logs_device_created_idx ON chat_logs(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_device_updated_idx ON conversations(device_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS events_device_deadline_idx ON events(device_id, deadline);

CREATE TRIGGER IF NOT EXISTS knowledge_items_updated_at AFTER UPDATE ON knowledge_items
BEGIN UPDATE knowledge_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS events_updated_at AFTER UPDATE ON events
BEGIN UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS conversations_updated_at AFTER UPDATE ON conversations
BEGIN UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
