PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student_leader')),
  phone TEXT, email TEXT, office TEXT, office_hours TEXT,
  scope TEXT NOT NULL DEFAULT 'category', notice_event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  source_excerpt TEXT, source_url TEXT, source_hash TEXT,
  notice_import_id TEXT REFERENCES knowledge_imports(id), reviewed_by TEXT, reviewed_at TEXT,
  reviewed_scope TEXT, review_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), question TEXT NOT NULL,
  answer TEXT NOT NULL, source_level INTEGER NOT NULL CHECK (source_level BETWEEN 1 AND 3),
  source_name TEXT NOT NULL, source_url TEXT,
  aliases TEXT NOT NULL DEFAULT '[]', source_excerpt TEXT, valid_from TEXT, valid_until TEXT,
  version INTEGER NOT NULL DEFAULT 1, reviewed_at TEXT, reviewed_by TEXT, origin_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'superseded', 'inactive')),
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
CREATE TABLE IF NOT EXISTS knowledge_item_versions (
  item_id TEXT NOT NULL REFERENCES knowledge_items(id), version INTEGER NOT NULL,
  snapshot TEXT NOT NULL, archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (item_id, version)
);
CREATE TABLE IF NOT EXISTS knowledge_imports (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, requested_url TEXT NOT NULL, source_url TEXT,
  title TEXT NOT NULL, source_text TEXT NOT NULL, published_date TEXT, date_candidates TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]', fetched_at TEXT, content_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('failed','fetched','review','published')),
  error_code TEXT, error_message TEXT, version INTEGER NOT NULL DEFAULT 1, contacts_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(source_url,content_hash)
);
CREATE TABLE IF NOT EXISTS knowledge_import_drafts (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES knowledge_imports(id), data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ignored','published')),
  published_item_id TEXT REFERENCES knowledge_items(id), reviewed_by TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS knowledge_import_publications (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES knowledge_imports(id), entries TEXT NOT NULL,
  result TEXT NOT NULL, reviewed_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  source_article_id TEXT, source_fetched_at TEXT, source_confirmed_at TEXT, publish_date_source TEXT,
  date_context TEXT, category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS information_sources (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article','column')), last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(owner_id,url)
);
CREATE TABLE IF NOT EXISTS source_links (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES information_sources(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, discovered_at TEXT NOT NULL,
  UNIQUE(source_id,url)
);
CREATE TABLE IF NOT EXISTS source_articles (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES information_sources(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, source_text TEXT NOT NULL,
  published_date TEXT, fetched_at TEXT NOT NULL, content_hash TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('complete','body_only')), revision INTEGER NOT NULL DEFAULT 1,
  attachments TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments) AND json_type(attachments) = 'array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(source_id,url)
);
CREATE TABLE IF NOT EXISTS source_article_versions (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES source_articles(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, revision INTEGER NOT NULL, source_text TEXT NOT NULL,
  content_hash TEXT NOT NULL, fetched_at TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', completeness TEXT NOT NULL DEFAULT 'legacy_unknown', UNIQUE(article_id,revision)
);

CREATE INDEX IF NOT EXISTS contacts_category_idx ON contacts(category_id);
CREATE INDEX IF NOT EXISTS knowledge_confirmed_priority_idx ON knowledge_items(source_level, updated_at DESC) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS tickets_device_created_idx ON tickets(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_logs_device_created_idx ON chat_logs(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_device_updated_idx ON conversations(device_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS events_device_deadline_idx ON events(device_id, deadline);
CREATE INDEX IF NOT EXISTS information_sources_owner_idx ON information_sources(owner_id);
CREATE INDEX IF NOT EXISTS source_articles_owner_idx ON source_articles(owner_id, source_id);

CREATE TRIGGER IF NOT EXISTS information_sources_limit BEFORE INSERT ON information_sources
WHEN (SELECT count(*) FROM information_sources WHERE owner_id = NEW.owner_id) >= 5
BEGIN SELECT RAISE(ABORT, 'source_limit'); END;

CREATE TRIGGER IF NOT EXISTS knowledge_items_updated_at AFTER UPDATE ON knowledge_items
BEGIN UPDATE knowledge_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS events_updated_at AFTER UPDATE ON events
BEGIN UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS conversations_updated_at AFTER UPDATE ON conversations
BEGIN UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
