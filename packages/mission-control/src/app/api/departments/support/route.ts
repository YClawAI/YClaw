import { NextResponse } from 'next/server';
import { getDepartmentData } from '@/lib/department-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await getDepartmentData(['keeper', 'guide']);
  return NextResponse.json(base);
}
