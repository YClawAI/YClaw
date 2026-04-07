import { NextResponse } from 'next/server';
import { getDepartmentData } from '@/lib/department-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await getDepartmentData(['ember', 'forge', 'scout']);
  return NextResponse.json(base);
}
