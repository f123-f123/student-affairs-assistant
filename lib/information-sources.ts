import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';

export type SourceKind = 'article' | 'column';
export type SourceLink = { url: string; title: string };
export const allowedDomains = () => (process.env.ALLOWED_FETCH_DOMAINS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
export const contentHash = (text: string) => createHash('sha256').update(text).digest('hex');

export function parseColumnLinks(html: string, pageUrl: string): SourceLink[] {
  const document = new JSDOM(html, { url: pageUrl }).window.document;
  const root = document.querySelector('main, .list, .news-list, #content');
  if (!root) return [];
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  return [...root.querySelectorAll('a[href]')].flatMap(anchor => {
    let url: URL;
    try { url = new URL(anchor.getAttribute('href') || '', pageUrl); } catch { return []; }
    const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
    url.hash = '';
    if (url.origin !== origin || url.toString() === pageUrl || !title || seen.has(url.toString())) return [];
    seen.add(url.toString());
    return [{ url: url.toString(), title }];
  }).slice(0, 10);
}
