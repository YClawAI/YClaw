import { NextResponse } from 'next/server';
import { getSkills } from '@/lib/openclaw';

export async function GET() {
  try {
    const skills = await getSkills();
    return NextResponse.json(skills);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
