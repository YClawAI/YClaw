export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

// STITCH_API_KEY is consumed server-side only — never sent to the client.
export async function GET() {
  if (!process.env.STITCH_API_KEY) {
    return NextResponse.json(
      { projects: [], warning: 'STITCH_API_KEY not configured' },
      { status: 200 },
    );
  }

  try {
    const { StitchClient } = await import('@yclaw/core');
    const client = new StitchClient();
    const result = await client.listProjects();
    return NextResponse.json({ projects: result.projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ projects: [], error: message }, { status: 200 });
  }
}
