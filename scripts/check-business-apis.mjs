const base = process.argv.find(argument => argument.startsWith('--base='))?.slice('--base='.length) || 'http://localhost:3000';
const expected = new Map([
  ['/api/conversations', 'conversations'], ['/api/events', 'events'],
  ['/api/tickets', 'tickets'], ['/api/sources', 'sources'],
]);

try {
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ account: 'student-a', passcode: '' }),
});
console.log(`学生测试登录：HTTP ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!login.ok || !cookie) {
  console.error('未取得测试会话；不继续业务接口验证。');
  process.exitCode = 1;
} else {
  for (const [path, field] of expected) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body[field]) ? body[field].length : null;
    console.log(`${path}：HTTP ${response.status}${rows === null ? '' : `，${field} ${rows} 条`}${body.code ? ` ${body.code}` : ''}${body.error ? ` ${body.error}` : ''}`);
    if (!response.ok || rows === null) process.exitCode = 1;
  }
}
} catch (cause) {
  console.error(`应用接口无法连接：${cause instanceof Error ? cause.cause?.code || cause.message : String(cause)}`);
  process.exitCode = 1;
}
