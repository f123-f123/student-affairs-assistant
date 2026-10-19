// 仅取正文开头明确写出的称呼，不能从类别或网址猜测学院及适用人群。
export function noticeAudience(source: string): string | null {
  return source.trimStart().match(/^(各位[^：:\n]{2,100}(?:同学|学生|老师|师生))[：:]/)?.[1] || null;
}
