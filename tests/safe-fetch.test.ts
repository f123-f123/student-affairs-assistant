import { describe, expect, it, vi } from 'vitest';
import { fetchNotice, isPublicAddress, parseNoticeHtml, FETCH_TOO_LONG, validateFetchTarget } from '../lib/safe-fetch';

describe('SSRF 防护', () => {
  it('拒绝回环及私有 IPv4，包括映射 IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.2', '169.254.1.1', '::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });
  it('白名单域名解析到内网时拒绝', async () => {
    await expect(validateFetchTarget('https://school.example/notice', ['school.example'], async () => [{ address: '10.0.0.1', family: 4 }])).rejects.toThrow();
  });
  it('重定向到内网前停止请求', async () => {
    const downloader = vi.fn(async () => ({ status: 302, location: 'http://10.0.0.1/private' }));
    await expect(fetchNotice('https://school.example/notice', ['school.example', '10.0.0.1'], async () => [{ address: '8.8.8.8', family: 4 }], downloader)).rejects.toThrow('抓取失败，请粘贴通知文本');
    expect(downloader).toHaveBeenCalledTimes(1);
  });
  it('长通知明确报错，不静默丢失尾部；提取可识别的发布时间', () => {
    const html = (body: string) => `<html><head><meta property="article:published_time" content="2026-10-15T09:00:00+08:00" /></head><body><article><h1>通知</h1><p>${body}</p></article></body></html>`;
    expect(parseNoticeHtml(html('办理说明'.repeat(30)), 'https://school.example/a')).toMatchObject({ publishedDate: '2026-10-15', completeness: 'complete' });
    expect(() => parseNoticeHtml(html('办理说明'.repeat(5000) + '尾部截止要求'), 'https://school.example/a')).toThrow(FETCH_TOO_LONG);
  });
  it('登录页不作为文章正文', () => {
    expect(() => parseNoticeHtml('<html><body><form><input type="password"></form><p>' + '登录后查看通知'.repeat(30) + '</p></body></html>', 'https://school.example/login')).toThrow('仅支持公开的静态 HTML 页面');
  });
});
