import { NextResponse } from 'next/server';
import { getCronJobs } from '@/lib/openclaw';

export async function GET() {
  try {
    const jobs = await getCronJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
