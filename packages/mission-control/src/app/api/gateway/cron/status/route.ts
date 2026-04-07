import { NextResponse } from 'next/server';
import { getCronStatus } from '@/lib/openclaw';

export async function GET() {
  try {
    const status = await getCronStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json(null, { status: 502 });
  }
}
