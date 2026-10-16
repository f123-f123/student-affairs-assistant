import { redirect } from 'next/navigation';
import { requireTeacher } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  if (!await requireTeacher()) redirect('/teacher/login');
  return children;
}
