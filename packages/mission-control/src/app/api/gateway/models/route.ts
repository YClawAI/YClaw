import { NextResponse } from 'next/server';
import { getModels } from '@/lib/openclaw';

export async function GET() {
  try {
    const models = await getModels();
    return NextResponse.json(models);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
