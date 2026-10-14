import { redirect } from 'next/navigation';
import { isTeacher } from '@/lib/teacher-auth';

export const dynamic = 'force-dynamic';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  if (!await isTeacher()) redirect('/teacher/login');
  return children;
}
