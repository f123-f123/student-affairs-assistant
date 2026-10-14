const STORAGE_KEY = 'student_affairs_device_id';

export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
