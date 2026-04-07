import { NextResponse } from 'next/server';
import { getGateway } from '@/lib/gateway-ws';

export async function GET() {
  const gateway = getGateway();
  return NextResponse.json({
    connected: gateway.connected,
    epoch: gateway.connectionEpoch,
  });
}
