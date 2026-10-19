import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { categoryContacts } from '@/lib/contact-storage';
import { unauthorized, noStore } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!await getCurrentUser()) return unauthorized();
  try {
    const db = getSupabase();
    const [categories, contacts] = await Promise.all([db.from('categories').select('id,name').order('sort_order'), categoryContacts(db)]);
    if (categories.error || contacts.error) throw categories.error || contacts.error;
    return NextResponse.json({ categories: categories.data, contacts: contacts.data, notice_supported: contacts.notice_supported }, { headers: noStore });
  } catch { return NextResponse.json({ error: '负责人选项读取失败', code: 'CONTACTS_UNAVAILABLE' }, { status: 503, headers: noStore }); }
}
