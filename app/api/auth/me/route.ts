import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mockEndpointEnabled, passcodeEnabled, publicUser } from '@/lib/auth-core';
import { noStore } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return NextResponse.json({ user: publicUser(await getCurrentUser()), passcodeEnabled: passcodeEnabled(), mockEnabled: mockEndpointEnabled(new URL(request.url).hostname), legacyEnabled: process.env.AUTH_MODE === 'legacy_teacher' }, { headers: noStore });
}
