import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { isDateOnly } from './validation';
import { publicationDates, selectPublicationDate } from './notice-dates';
import { NoticeFetchError } from './fetch-errors';
import type { NoticeAttachment } from './types';
export { FETCH_FAILURE, FETCH_TOO_LONG, FETCH_UNSUPPORTED } from './fetch-errors';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const dohProviders = {
  alidns: { host: 'dns.alidns.com', address: '223.5.5.5', path: '/resolve' },
  cloudflare: { host: 'cloudflare-dns.com', address: '1.1.1.1', path: '/dns-query' },
} as const;

export type ResolvedAddress = { address: string; family: number };
type PageResponse = { status: number; location?: string; html?: string };
type Resolver = (host: string) => Promise<ResolvedAddress[]>;
type Downloader = (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<PageResponse>;
type PinnedResponse = { status: number; headers: http.IncomingHttpHeaders; body: string };

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const normalized = parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address() : parsed;
    return normalized.range() === 'unicast';
  } catch { return false; }
}

// 固定已校验 IP；Host、SNI 和证书校验使用原域名，不使用系统代理或二次 DNS。
function pinnedRequest(url: URL, address: ResolvedAddress, signal: AbortSignal, accept: string, maxBytes = MAX_BYTES): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const options: http.RequestOptions & { autoSelectFamily: boolean; rejectUnauthorized: boolean } = {
      method: 'GET', signal, autoSelectFamily: false, family: address.family, rejectUnauthorized: true,
      headers: { 'User-Agent': 'StudentAffairsDemo/1.0', Accept: accept },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    };
    const request = transport.request(url, options, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume(); resolve({ status, headers: response.headers, body: '' }); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new NoticeFetchError('FETCH_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const charset = /charset=["']?([^;\s"']+)/i.exec(response.headers['content-type'] || '')?.[1] || 'utf-8';
          resolve({ status, headers: response.headers, body: new TextDecoder(charset).decode(Buffer.concat(chunks)) });
        } catch { reject(new NoticeFetchError('FETCH_UNSUPPORTED')); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

export function fetchDnsMode(): 'system' | 'doh' {
  const mode = process.env.FETCH_DNS_MODE || 'system';
  if (mode !== 'system' && mode !== 'doh') throw new NoticeFetchError('FETCH_DNS_CONFIG');
  return mode;
}

export async function resolveFetchAddresses(host: string): Promise<ResolvedAddress[]> {
  try {
    if (fetchDnsMode() === 'system') return await lookup(host, { all: true, verbatim: true });
    const providerName = process.env.FETCH_DOH_PROVIDER || 'alidns';
    if (!Object.hasOwn(dohProviders, providerName)) throw new NoticeFetchError('FETCH_DNS_CONFIG');
    const provider = dohProviders[providerName as keyof typeof dohProviders];
    const signal = AbortSignal.timeout(5_000);
    const results = await Promise.all([1, 28].map(async type => {
      const url = new URL('https://' + provider.host + provider.path);
      url.searchParams.set('name', host); url.searchParams.set('type', type === 1 ? 'A' : 'AAAA');
      const response = await pinnedRequest(url, { address: provider.address, family: 4 }, signal, 'application/dns-json', 64 * 1024);
      if (response.status !== 200) throw new NoticeFetchError('FETCH_DNS_FAILED');
      return parseDnsAnswer(JSON.parse(response.body), host, type);
    }));
    return results.flat();
  } catch (cause) {
    if (cause instanceof NoticeFetchError && cause.code === 'FETCH_DNS_CONFIG') throw cause;
    throw new NoticeFetchError('FETCH_DNS_FAILED');
  }
}

export function parseDnsAnswer(value: unknown, host: string, type: number): ResolvedAddress[] {
  const data = value as { Status?: number; Question?: { name?: string; type?: number }[] | { name?: string; type?: number }; Answer?: { name?: string; type?: number; data?: string }[] } | null;
  const question = Array.isArray(data?.Question) ? data.Question[0] : data?.Question;
  if (data?.Status !== 0 || question?.name?.toLowerCase().replace(/\.$/, '') !== host || question.type !== type ||
      (data.Answer !== undefined && !Array.isArray(data.Answer))) throw new NoticeFetchError('FETCH_DNS_FAILED');
  const aliases = new Set([host]);
  const answers = data.Answer ?? [];
  for (let pass = 0; pass < answers.length; pass++) for (const answer of answers) {
    if (answer.type === 5 && answer.name && answer.data && aliases.has(answer.name.toLowerCase().replace(/\.$/, ''))) aliases.add(answer.data.toLowerCase().replace(/\.$/, ''));
  }
  return answers.filter(answer => answer.type === type && answer.name && aliases.has(answer.name.toLowerCase().replace(/\.$/, ''))).map(answer => {
    if (!answer.data || !ipaddr.isValid(answer.data) || (ipaddr.parse(answer.data).kind() === 'ipv4' ? 1 : 28) !== type) throw new NoticeFetchError('FETCH_DNS_FAILED');
    return { address: answer.data, family: type === 1 ? 4 : 6 };
  });
}

export async function validateFetchTarget(input: string, allowedDomains: string[], resolver: Resolver = resolveFetchAddresses): Promise<{ url: URL; address: ResolvedAddress }> {
  let url: URL;
  try { url = new URL(input); } catch { throw new NoticeFetchError('FETCH_INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw new NoticeFetchError('FETCH_INVALID_URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[/, '').replace(/\]$/, '');
  if (!allowedDomains.length) throw new NoticeFetchError('FETCH_ALLOWLIST_EMPTY');
  if (!host || !allowedDomains.includes(host)) throw new NoticeFetchError('FETCH_DOMAIN_NOT_ALLOWED');
  let addresses: ResolvedAddress[];
  try { addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await resolver(host); }
  catch (cause) { throw cause instanceof NoticeFetchError ? cause : new NoticeFetchError('FETCH_DNS_FAILED'); }
  if (!addresses.length) throw new NoticeFetchError('FETCH_DNS_FAILED');
  if (addresses.some(entry => !isPublicAddress(entry.address))) throw new NoticeFetchError('FETCH_DNS_NON_PUBLIC', { addresses: addresses.map(entry => entry.address) });
  return { url, address: addresses[0] };
}

async function downloadPage(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<PageResponse> {
  const response = await pinnedRequest(url, address, signal, 'text/html');
  if (response.status >= 300 && response.status < 400) return { status: response.status, location: response.headers.location };
  if (response.status !== 200) throw new NoticeFetchError('FETCH_HTTP_FAILED', { http_status: response.status });
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers['content-type'] || '')) throw new NoticeFetchError('FETCH_UNSUPPORTED');
  return { status: response.status, html: response.body };
}

export async function fetchValidatedHtml(input: string, allowedDomains: string[], resolver?: Resolver, downloader: Downloader = downloadPage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new NoticeFetchError('FETCH_TIMEOUT')), { once: true }));
  const hops: { host: string; address: string }[] = [];
  try {
    let next = input;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const { url, address } = await Promise.race([validateFetchTarget(next, allowedDomains, resolver), timedOut]);
      hops.push({ host: url.hostname, address: address.address });
      const response = await Promise.race([downloader(url, address, controller.signal), timedOut]);
      if (response.status >= 300 && response.status < 400 && response.location) {
        next = new URL(response.location, url).toString(); continue;
      }
      if (response.status !== 200 || !response.html) throw new NoticeFetchError('FETCH_HTTP_FAILED', { http_status: response.status });
      return { html: response.html, sourceUrl: url.toString(), fetchedAt: new Date().toISOString(), diagnostics: {
        dns_mode: resolver ? 'custom' : fetchDnsMode(), doh_provider: !resolver && fetchDnsMode() === 'doh' ? process.env.FETCH_DOH_PROVIDER || 'alidns' : null,
        http_status: response.status, hops,
      } };
    }
    throw new NoticeFetchError('FETCH_REDIRECT_LIMIT');
  } catch (cause) {
    if (controller.signal.aborted) throw new NoticeFetchError('FETCH_TIMEOUT');
    throw cause instanceof NoticeFetchError ? cause : new NoticeFetchError('FETCH_NETWORK_FAILED');
  } finally { clearTimeout(timeout); }
}

export function parseNoticeHtml(html: string, sourceUrl: string) {
  const dom = new JSDOM(html, { url: sourceUrl });
  try {
    const document = dom.window.document;
    if (document.querySelector('form input[type="password"]')) throw new NoticeFetchError('FETCH_UNSUPPORTED');
    const dates = [
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content'),
      document.querySelector('meta[name="datePublished"], meta[name="publishdate"]')?.getAttribute('content'),
      document.querySelector('time[pubdate][datetime], time.published[datetime], time[itemprop="datePublished"][datetime]')?.getAttribute('datetime'),
    ];
    const attachments: NoticeAttachment[] = [];
    const seen = new Set<string>();
    for (const anchor of document.querySelectorAll('a[href]')) {
      let url: URL;
      try { url = new URL(anchor.getAttribute('href') || '', sourceUrl); } catch { continue; }
      const name = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
      const extension = /\.(docx?|pdf|xlsx?|pptx?|zip|rar)$/i.exec(url.pathname)?.[1] || /\.(docx?|pdf|xlsx?|pptx?|zip|rar)$/i.exec(name)?.[1];
      if (!extension || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      seen.add(url.href);
      let filename = url.pathname.split('/').pop() || '附件';
      try { filename = decodeURIComponent(filename); } catch { /* 保留原文件名。 */ }
      attachments.push({ name: name || filename, url: url.href, format: extension.toLowerCase(), status: 'unparsed' });
    }
    const article = new Readability(document).parse();
    const sourceText = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (sourceText.length < 80) throw new NoticeFetchError('FETCH_UNSUPPORTED');
    if (sourceText.length > 20000) throw new NoticeFetchError('FETCH_TOO_LONG');
    const dateCandidates = publicationDates(sourceText, dates.filter((value): value is string => !!value && isDateOnly(value.slice(0, 10)))
      .map(value => ({ date: value.slice(0, 10), kind: 'page' as const, evidence: `网页发布日期元数据：${value}` })));
    const selectedDate = selectPublicationDate(dateCandidates, null);
    return { title: article?.title?.trim() || document.title.trim() || '未命名文章', sourceText,
      publishedDate: selectedDate.date, dateCandidates,
      completeness: 'body_only' as const, attachments,
      warning: attachments.length ? '仅已提取网页正文；附件尚未解析，整份通知资料不完整，请打开附件人工核对。' : '仅已提取网页正文，未解析附件；整份通知资料完整性未核验。',
    };
  } finally { dom.window.close(); }
}

export async function fetchNotice(input: string, allowedDomains: string[], resolver?: Resolver, downloader: Downloader = downloadPage) {
  const page = await fetchValidatedHtml(input, allowedDomains, resolver, downloader);
  return { ...parseNoticeHtml(page.html, page.sourceUrl), sourceUrl: page.sourceUrl, fetchedAt: page.fetchedAt, diagnostics: page.diagnostics };
}
