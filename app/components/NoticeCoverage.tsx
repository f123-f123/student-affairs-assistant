import type { NoticeAttachment } from '@/lib/types';

export default function NoticeCoverage({ attachments = [], legacy = false }: { attachments?: NoticeAttachment[]; legacy?: boolean }) {
  return <div className="notice notice-warning" role="status">
    <strong>{legacy ? '历史网页快照：附件覆盖情况未记录。' : '仅已提取网页正文；整份通知资料完整性未核验。'}</strong>
    <p>附件尚未解析，也未用于事项整理。请打开原文和附件人工核对材料及截止时间。</p>
    {attachments.length > 0 && <ul className="mt-2 space-y-1">{attachments.map(item => <li key={item.url}>
      <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a> · {item.format.toUpperCase()} · 未解析
    </li>)}</ul>}
  </div>;
}
