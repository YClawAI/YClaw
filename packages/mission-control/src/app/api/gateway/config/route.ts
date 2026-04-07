import { NextResponse } from 'next/server';
import { getGatewayConfig } from '@/lib/openclaw';

export async function GET() {
  try {
    const config = await getGatewayConfig();
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(null, { status: 502 });
  }
}
