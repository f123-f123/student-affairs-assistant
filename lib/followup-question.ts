// Conversation text only clarifies the student's reference; it never becomes knowledge evidence.
export function retrievalQuestion(question: string, previousQuestion: string | null): string {
  if (!previousQuestion || !/^(?:那|那么|这个|这些|它|其|还|具体|需要|要|材料|怎么办|如何)/.test(question.trim())) return question;
  return `${previousQuestion}；追问：${question}`.slice(0, 1000);
}
