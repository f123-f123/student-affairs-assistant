const failures = {
  FETCH_ALLOWLIST_EMPTY: ['服务端未配置信息源域名白名单', 503, 'allowlist'],
  FETCH_DOMAIN_NOT_ALLOWED: ['网址域名不在允许列表内', 403, 'allowlist'],
  FETCH_INVALID_URL: ['仅支持无凭据、标准端口的 HTTP/HTTPS 公开网址', 400, 'url'],
  FETCH_DNS_CONFIG: ['抓取 DNS 配置无效，请选择 system 或 doh 及受支持的 DoH 服务', 503, 'dns'],
  FETCH_DNS_FAILED: ['域名解析失败，请检查 DNS 或显式配置受信任 DoH', 502, 'dns'],
  FETCH_DNS_NON_PUBLIC: ['域名解析到非公网地址；若使用 Fake-IP 代理，请显式配置 DoH，不能放行保留地址', 422, 'dns'],
  FETCH_NETWORK_FAILED: ['连接已校验的公网地址失败，请检查网络或代理路由', 502, 'connect'],
  FETCH_HTTP_FAILED: ['目标网页返回非成功状态', 502, 'http'],
  FETCH_TIMEOUT: ['网页抓取超时，请稍后重试', 504, 'fetch'],
  FETCH_REDIRECT_LIMIT: ['网页重定向次数超过限制', 422, 'redirect'],
  FETCH_TOO_LARGE: ['网页响应超过大小限制，已停止抓取', 422, 'http'],
  FETCH_UNSUPPORTED: ['仅支持公开的静态 HTML 页面；PDF、登录页或动态页面请手动提供原文', 422, 'parse'],
  FETCH_TOO_LONG: ['通知正文超过20000字，已停止提取；请提供完整原文或较短的单篇文章', 422, 'parse'],
} as const;

export type FetchErrorCode = keyof typeof failures;
export class NoticeFetchError extends Error {
  readonly status: number;
  readonly stage: string;
  constructor(public code: FetchErrorCode, public details?: Record<string, unknown>) {
    super(failures[code][0]);
    this.status = failures[code][1]; this.stage = failures[code][2];
  }
}

export const FETCH_FAILURE = '抓取失败，请粘贴通知文本';
export const FETCH_TOO_LONG = failures.FETCH_TOO_LONG[0];
export const FETCH_UNSUPPORTED = failures.FETCH_UNSUPPORTED[0];
