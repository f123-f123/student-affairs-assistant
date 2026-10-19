import { readFile, writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd(), true);
const manifest = JSON.parse(await readFile(new URL('../artifacts/demo-knowledge-20261016.json', import.meta.url), 'utf8'));
const target = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.DB_PROVIDER !== 'supabase' || !key || !target || new URL(target).origin !== manifest.target) throw new Error('验证目标不一致');
const db = createClient(target, key, { auth: { persistSession: false, autoRefreshToken: false } });
const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:3104';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('验收仅调用本机真实应用，不向其他站点发送会话');
const reportPath = new URL('../artifacts/demo-knowledge-20261016-qa.json', import.meta.url);
const report = {
  batch_id: manifest.batch_id, target: manifest.target, application: base, checked_at: new Date().toISOString(),
  note: '真实学生登录和 /api/conversations、/api/ask；会产生测试对话与正常 chat_logs，未创建工单、老师回复或沉淀知识。',
  results: [],
};
async function save() { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
async function select(query) {
  const result = await query;
  if (result.error) throw new Error(`数据库核对失败（${result.error.code || 'connection_error'}）`);
  return result;
}
const countKnowledge = () => select(db.from('knowledge_items').select('id', { count: 'exact', head: true })).then(r => r.count);
const countTickets = () => select(db.from('tickets').select('id', { count: 'exact', head: true })).then(r => r.count);
report.before = { knowledge: await countKnowledge(), tickets: await countTickets() };
await save();
let cookie;
async function request(path, body) {
  const response = await fetch(new URL(path, base), {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(55000),
  });
  return { status: response.status, body: await response.json(), response };
}
try {
  const login = await request('/api/auth/login', { account: 'student-a', passcode: '' });
  report.login_status = login.status;
  if (login.status !== 200) throw new Error(`真实学生登录失败（HTTP ${login.status}）`);
  cookie = login.response.headers.getSetCookie().find(value => value.startsWith('student_affairs_session='))?.split(';')[0];
  if (!cookie) throw new Error('未收到学生会话');
  const checks = [
    { question: '困难认定要准备什么材料？', expected_id: manifest.items[0].id },
    { question: '英文在读证明怎么申请？', expected_id: manifest.items[5].id },
    { question: '校园卡丢了怎么挂失？', expected_id: manifest.items[8].id },
    { question: '缓考怎么申请', gap: true },
    { question: '我考试冲突想延后考怎么办', gap: true },
    { question: '宿舍怎么调换', gap: true },
  ];
  for (const check of checks) {
    const row = { ...check };
    report.results.push(row);
    const conversation = await request('/api/conversations', {});
    row.conversation_status = conversation.status;
    if (conversation.status !== 201 || !conversation.body.conversation?.id) throw new Error('创建验收对话失败');
    row.conversation_id = conversation.body.conversation.id;
    const owner = await select(db.from('conversations').select('id,device_id').eq('id', row.conversation_id).single());
    if (owner.data.device_id !== 'a1000000-0000-4000-8000-000000000001') throw new Error('应用与当前数据库或测试身份不一致，停止问答');
    const result = await request('/api/ask', { question: check.question, conversation_id: row.conversation_id });
    row.http_status = result.status;
    // 报告不保存 Cookie、密钥或联系人个人信息。
    const { contacts = [], ...body } = result.body;
    row.response = { ...body, contact_ids: contacts.map(contact => contact.id) };
    if (result.status !== 200) {
      row.passed = false;
      row.failure = result.body.code === 'MODEL_UNAVAILABLE' ? '模型不可用：数据库导入结果独立有效，问答未通过验证' : '问答接口未成功';
      await save();
      console.log(JSON.stringify({ question: check.question, http_status: result.status, code: result.body.code, passed: false }));
      continue;
    }
    const logs = await select(db.from('chat_logs').select('id,question,error_type,response_json').eq('conversation_id', row.conversation_id));
    row.log_ids = logs.data.map(log => log.id);
    row.log_error_types = logs.data.map(log => log.error_type);
    row.log_snapshot_matches = logs.data.length === 1 && logs.data[0].question === check.question &&
      JSON.stringify(logs.data[0].response_json) !== undefined && logs.data[0].response_json?.answerable === body.answerable;
    const storedContacts = body.category_id ? (await select(db.from('contacts').select('id,name,role,phone,email,office,office_hours').eq('category_id', body.category_id))).data : [];
    row.contacts_match_database = contacts.length === storedContacts.length && contacts.every(contact => storedContacts.some(stored =>
      Object.keys(stored).every(field => contact[field] === stored[field])));
    row.no_model_contact_details = !/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[-－]?\d{7,8})(?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(body.answer || '');
    if (check.gap) {
      row.gap_preserved = body.answerable === false && Array.isArray(body.citations) && body.citations.length === 0;
      row.passed = row.gap_preserved && row.contacts_match_database && row.no_model_contact_details && row.log_snapshot_matches;
    } else {
      const citations = Array.isArray(body.citations) ? body.citations : [];
      const stored = (await select(db.from('knowledge_items').select('id,question,answer,source_name,source_excerpt,source_url,source_level,version').in('id', manifest.items.map(item => item.id)))).data;
      row.citations_match_database = citations.length > 0 && citations.every(citation => stored.some(item => Object.keys(item).every(field => citation[field] === item[field])));
      row.fictional_sources_visible = citations.length > 0 && citations.every(citation => citation.source_name === manifest.source_name &&
        citation.source_excerpt?.startsWith('【虚构演示，非浙江大学政策】') && citation.source_level === 2 && citation.source_url === null);
      row.expected_topic_cited = citations.some(citation => citation.id === check.expected_id);
      row.passed = body.answerable === true && row.expected_topic_cited && row.citations_match_database && row.fictional_sources_visible &&
        row.contacts_match_database && row.no_model_contact_details && row.log_snapshot_matches;
    }
    await save();
    console.log(JSON.stringify({ question: check.question, http_status: result.status, answerable: body.answerable, citations: body.citations?.map(citation => citation.id), passed: row.passed }));
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : '验证失败';
} finally {
  report.after = { knowledge: await countKnowledge(), tickets: await countTickets() };
  report.no_knowledge_or_ticket_created = report.after.knowledge === report.before.knowledge && report.after.tickets === report.before.tickets;
  report.passed = report.results.length === 6 && report.results.every(row => row.passed) && report.no_knowledge_or_ticket_created;
  await save();
}
console.log(JSON.stringify({ passed: report.passed, results: report.results.length, failure: report.failure, before: report.before, after: report.after }));
if (!report.passed) process.exitCode = 1;
