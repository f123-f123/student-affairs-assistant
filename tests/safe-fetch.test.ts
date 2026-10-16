import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotice, isPublicAddress, parseNoticeHtml, parseDnsAnswer, resolveFetchAddresses, FETCH_TOO_LONG, validateFetchTarget } from '../lib/safe-fetch';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('SSRF 防护', () => {
  it('下载器未响应 AbortSignal 时仍在10秒内结束', async () => {
    vi.useFakeTimers();
    const pending = fetchNotice('https://school.example/notice', ['school.example'],
      async () => [{ address: '8.8.8.8', family: 4 }], () => new Promise(() => {}));
    const assertion = expect(pending).rejects.toMatchObject({ code: 'FETCH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
  it('拒绝回环及私有 IPv4，包括映射 IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.2', '169.254.1.1', '198.18.1.4', '198.19.255.255', '::1', '::ffff:127.0.0.1', '::ffff:198.18.1.4', 'fc00::1', 'fe80::1']) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });
  it('白名单域名解析到内网时拒绝', async () => {
    await expect(validateFetchTarget('https://school.example/notice', ['school.example'], async () => [{ address: '10.0.0.1', family: 4 }])).rejects.toThrow();
  });
  it('重定向到内网前停止请求', async () => {
    const downloader = vi.fn(async () => ({ status: 302, location: 'http://10.0.0.1/private' }));
    await expect(fetchNotice('https://school.example/notice', ['school.example', '10.0.0.1'], async () => [{ address: '8.8.8.8', family: 4 }], downloader)).rejects.toMatchObject({ code: 'FETCH_DNS_NON_PUBLIC' });
    expect(downloader).toHaveBeenCalledTimes(1);
  });
  it('长通知明确报错，不静默丢失尾部；提取可识别的发布时间', () => {
    const html = (body: string) => `<html><head><meta property="article:published_time" content="2026-10-15T09:00:00+08:00" /></head><body><article><h1>通知</h1><p>${body}</p></article></body></html>`;
    expect(parseNoticeHtml(html('办理说明'.repeat(30)), 'https://school.example/a')).toMatchObject({ publishedDate: '2026-10-15', completeness: 'body_only' });
    expect(() => parseNoticeHtml(html('办理说明'.repeat(5000) + '尾部截止要求'), 'https://school.example/a')).toThrow(FETCH_TOO_LONG);
  });
  it('登录页不作为文章正文', () => {
    expect(() => parseNoticeHtml('<html><body><form><input type="password"></form><p>' + '登录后查看通知'.repeat(30) + '</p></body></html>', 'https://school.example/login')).toThrow('仅支持公开的静态 HTML 页面');
  });
  it('网页中的无效发布日期保持未知，避免推算出错误的截止日', () => {
    const html = '<html><head><meta name="publishdate" content="2026-02-30" /></head><body><article><h1>通知</h1><p>' + '申请说明'.repeat(30) + '</p></article></body></html>';
    expect(parseNoticeHtml(html, 'https://school.example/a').publishedDate).toBeNull();
  });
  it('白名单为空和域名不允许有不同错误码，均不查询 DNS', async () => {
    const resolver = vi.fn();
    await expect(validateFetchTarget('https://school.example/a', [], resolver)).rejects.toMatchObject({ code: 'FETCH_ALLOWLIST_EMPTY' });
    await expect(validateFetchTarget('https://school.example/a', ['other.example'], resolver)).rejects.toMatchObject({ code: 'FETCH_DOMAIN_NOT_ALLOWED' });
    expect(resolver).not.toHaveBeenCalled();
  });
  it('Fake-IP 及公网和私网混合解析不进行下载，不静默改用其他解析器', async () => {
    const downloader = vi.fn();
    for (const addresses of [[{ address: '198.18.1.4', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
      await expect(fetchNotice('https://school.example/a', ['school.example'], async () => addresses, downloader)).rejects.toMatchObject({ code: 'FETCH_DNS_NON_PUBLIC' });
    }
    expect(downloader).not.toHaveBeenCalled();
  });
  it('DoH 校验查询域名和类型，只接受目标的地址或 CNAME 链，解析后的私网地址仍被拒绝', async () => {
    const response = { Status: 0, Question: [{ name: 'school.example.', type: 1 }], Answer: [
      { name: 'school.example.', type: 5, data: 'edge.example.' },
      { name: 'edge.example.', type: 1, data: '198.18.1.4' },
      { name: 'unrelated.example.', type: 1, data: '8.8.8.8' },
    ] };
    expect(parseDnsAnswer(response, 'school.example', 1)).toEqual([{ address: '198.18.1.4', family: 4 }]);
    await expect(validateFetchTarget('https://school.example/a', ['school.example'], async () => parseDnsAnswer(response, 'school.example', 1))).rejects.toMatchObject({ code: 'FETCH_DNS_NON_PUBLIC' });
    expect(() => parseDnsAnswer(response, 'different.example', 1)).toThrow();
    expect(() => parseDnsAnswer({ ...response, Status: 2 }, 'school.example', 1)).toThrow();
  });
  it('DoH 不允许任意内网服务器配置，错误模式也不回退', async () => {
    vi.stubEnv('FETCH_DNS_MODE', 'doh'); vi.stubEnv('FETCH_DOH_PROVIDER', 'http://127.0.0.1');
    await expect(resolveFetchAddresses('school.example')).rejects.toMatchObject({ code: 'FETCH_DNS_CONFIG' });
    vi.stubEnv('FETCH_DNS_MODE', 'auto');
    await expect(resolveFetchAddresses('school.example')).rejects.toMatchObject({ code: 'FETCH_DNS_CONFIG' });
  });
  it('识别 DOCX/DOC 附件，去重，正文有内容也不表示整份资料完整', () => {
    const html = '<html><body><article><h1>通知</h1><p>' + '办理说明'.repeat(30) + '</p>' +
      '<a href="/files/form.docx">申请表.docx</a><a href="/files/rules.doc?download=1">细则.doc</a>' +
      '<a href="/files/form.docx">重复</a><a href="javascript:void(0)">伪造.doc</a></article></body></html>';
    const article = parseNoticeHtml(html, 'https://school.example/a');
    expect(article.completeness).toBe('body_only');
    expect(article.attachments).toEqual([
      { name: '申请表.docx', url: 'https://school.example/files/form.docx', format: 'docx', status: 'unparsed' },
      { name: '细则.doc', url: 'https://school.example/files/rules.doc?download=1', format: 'doc', status: 'unparsed' },
    ]);
    expect(article.warning).toContain('附件尚未解析');
  });
});
