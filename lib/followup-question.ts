// Conversation text only clarifies the student's reference; it never becomes knowledge evidence.
import { namedProjects } from './knowledge-scope';
export function isTopicFollowup(question: string) {
  return /^(?:那|那么|这个|这些|这份|这条|该通知|该事项|它|其|还|具体|需要|要|材料|怎么办|如何|什么时候截止|何时截止|截止了吗|找谁|联系谁)/.test(question.trim()) &&
    !/(?:学院|学园|奖学金|请假|证明|宿舍|校园卡|实习)/.test(question);
}
export function retrievalQuestion(question: string, previousQuestion: string | null): string {
  if (!previousQuestion) return question;
  const projects = namedProjects(question), previousProjects = namedProjects(previousQuestion);
  const sameProject = projects.length > 0 && projects.every(project => previousProjects.includes(project)) && !/学院|学园|20\d{2}(?:级|年度|[-—–至]20\d{2}学年)/.test(question);
  if (!isTopicFollowup(question) && !sameProject) return question;
  return `${previousQuestion}；追问：${question}`.slice(0, 1000);
}

export function topicFromHistory(rows: { question: string; response_json?: { topic_context?: { question: string } } | null }[]): string | null {
  const latest = rows.find(row => row.response_json?.topic_context?.question || !isTopicFollowup(row.question));
  return latest?.response_json?.topic_context?.question || latest?.question || null;
}
