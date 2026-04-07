import { NextResponse } from 'next/server';
import { getDepartmentData } from '@/lib/department-data';
import { getPendingApprovalCount } from '@/lib/approvals-queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await getDepartmentData(['strategist', 'reviewer']);
  const pendingApprovals = await getPendingApprovalCount();

  return NextResponse.json({ ...base, pendingApprovals });
}
