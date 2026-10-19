export function stageTiming(name: string) {
  const timings: Record<string, number> = {};
  return { timings, async run<T>(stage: string, work: () => T | PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await work(); } finally { timings[stage] = Math.round(performance.now() - start); }
  }, finish() { console.info('[timing]', name, timings); return Object.entries(timings).map(([key, value]) => `${key};dur=${value}`).join(', '); } };
}
