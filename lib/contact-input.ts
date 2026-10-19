import type { Contact } from './types';
import { UUID_RE } from './validation';

export function parseContact(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('负责人信息格式无效');
  const input = value as Record<string, unknown>;
  const text = (field: string, max: number) => {
    const value = input[field];
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('负责人字段格式无效');
    return value.trim() || null;
  };
  const category_id = text('category_id', 36), name = text('name', 80);
  if (!category_id || !UUID_RE.test(category_id) || !name || !['teacher', 'student_leader'].includes(String(input.role))) throw new Error('请填写类别、姓名和有效角色');
  const phone = text('phone', 50), email = text('email', 254);
  if (phone && !/^\+?[\d ()-]{3,40}(?:转\d{1,8})?$/.test(phone)) throw new Error('电话格式无效');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式无效');
  return { category_id, name, role: input.role as Contact['role'], phone, email, office: text('office', 200), office_hours: text('office_hours', 200) };
}
export function isDemoContact(contact: Pick<Contact, 'name' | 'office' | 'office_hours'> & { id?: string }) {
  return /演示|虚构|示例/.test(`${contact.name} ${contact.office || ''} ${contact.office_hours || ''}`) ||
    /^20000000-0000-4000-8000-00000000000[1-8]$/.test(contact.id || '');
}
