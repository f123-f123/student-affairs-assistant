import { createHash } from 'node:crypto';
export const replyFingerprint = (id: string, version: number, reply: string) => createHash('sha256').update(JSON.stringify([id, version, reply])).digest('hex');
