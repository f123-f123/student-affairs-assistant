import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SQLite 迁移离线预览', () => {
  it('包含个人信息源、文章及历史版本，预览不修改源数据', () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const path = join(tmpdir(), `student-affairs-migration-${randomUUID()}.sqlite`);
    const raw = new DatabaseSync(path);
    try {
      try {
        raw.exec(readFileSync(join(process.cwd(), 'local/schema.sql'), 'utf8'));
        raw.prepare('INSERT INTO information_sources(id,owner_id,name,url,kind) VALUES (?,?,?,?,?)').run('source', 'owner', '通知', 'https://school.example/list', 'column');
        raw.prepare('INSERT INTO source_articles(id,source_id,owner_id,url,title,source_text,fetched_at,content_hash,completeness) VALUES (?,?,?,?,?,?,?,?,?)')
          .run('article', 'source', 'owner', 'https://school.example/article', '文章', '正文', '2026-10-16T00:00:00Z', 'hash', 'complete');
        raw.prepare('INSERT INTO source_article_versions(id,article_id,owner_id,revision,source_text,content_hash,fetched_at) VALUES (?,?,?,?,?,?,?)')
          .run('version', 'article', 'owner', 1, '旧正文', 'old-hash', '2026-10-15T00:00:00Z');
      } finally { raw.close(); }
      const before = readFileSync(path);
      const output = execFileSync(process.execPath, [join(process.cwd(), 'scripts/sqlite-to-supabase.mjs'), `--sqlite=${path}`], {
        encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
      });
      for (const table of ['information_sources', 'source_articles', 'source_article_versions']) expect(output).toContain(`${table}: 源 1`);
      expect(output.indexOf('source_articles:')).toBeLessThan(output.indexOf('events:'));
      expect(readFileSync(path)).toEqual(before);
    } finally { unlinkSync(path); }
  });
});
