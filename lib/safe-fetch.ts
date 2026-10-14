import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const FETCH_FAILURE = '抓取失败，请粘贴通知文本';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type ResolvedAddress = { address: string; family: number };
type PageResponse = { status: number; location?: string; html?: string };
type Resolver = (host: string) => Promise<ResolvedAddress[]>;
type Downloader = (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<PageResponse>;

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const normalized = parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address() : parsed;
    return normalized.range() === 'unicast';
  } catch { return false; }
}

export async function validateFetchTarget(input: string, allowedDomains: string[], resolver: Resolver = async host => lookup(host, { all: true, verbatim: true })): Promise<{ url: URL; address: ResolvedAddress }> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error(FETCH_FAILURE); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw new Error(FETCH_FAILURE);
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[/, '').replace(/\]$/, '');
  if (!allowedDomains.includes(host) || !host) throw new Error(FETCH_FAILURE);
  const addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await resolver(host);
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error(FETCH_FAILURE);
  return { url, address: addresses[0] };
}

async function downloadPage(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET', signal,
      headers: { 'User-Agent': 'StudentAffairsDemo/1.0', 'Accept': 'text/html' },
      // 固定已校验的 DNS 结果，避免解析后连接时被重绑定到内网。
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location: response.headers.location });
        return;
      }
      if (status !== 200 || !/^text\/html(?:\s*;|$)/i.test(response.headers['content-type'] || '')) {
        response.resume(); reject(new Error(FETCH_FAILURE)); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { request.destroy(new Error(FETCH_FAILURE)); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const charset = /charset=([^;\s]+)/i.exec(response.headers['content-type'] || '')?.[1] || 'utf-8';
          resolve({ status, html: new TextDecoder(charset).decode(Buffer.concat(chunks)) });
        } catch { reject(new Error(FETCH_FAILURE)); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

export async function fetchNotice(input: string, allowedDomains: string[], resolver?: Resolver, downloader: Downloader = downloadPage): Promise<{ sourceText: string; sourceUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(FETCH_FAILURE)), { once: true }));
  try {
    let next = input;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const { url, address } = await Promise.race([validateFetchTarget(next, allowedDomains, resolver), timedOut]);
      const response = await downloader(url, address, controller.signal);
      if (response.status >= 300 && response.status < 400 && response.location) {
        next = new URL(response.location, url).toString();
        continue;
      }
      if (response.status !== 200 || !response.html) throw new Error(FETCH_FAILURE);
      const document = new JSDOM(response.html, { url: url.toString() }).window.document;
      const article = new Readability(document).parse();
      const sourceText = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (sourceText.length < 80) throw new Error(FETCH_FAILURE);
      return { sourceText: sourceText.slice(0, 20000), sourceUrl: url.toString() };
    }
    throw new Error(FETCH_FAILURE);
  } catch { throw new Error(FETCH_FAILURE); }
  finally { clearTimeout(timeout); }
}
