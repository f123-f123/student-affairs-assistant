// 仅整理可信的连续编号；日期、小数、版本和 URL 保持原样，数据库内容不变。
export function displayAnswer(answer: string): string {
  if (answer.includes('\n')) return answer;
  const pattern = /(^|[\s。；：:])([1-9])([、．.]|\))\s*(?=[\p{Script=Han}A-Za-z])/gu;
  const matches = [...answer.matchAll(pattern)];
  if (matches.length < 3 || matches.some((match, index) => Number(match[2]) !== index + 1 || match[3] !== matches[0][3])) return answer;
  return answer.replace(pattern, (_all, prefix: string, number: string, punctuation: string, offset: number) =>
    `${offset ? prefix.trimEnd() + '\n' : ''}${number}${punctuation} `);
}
