import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function getVaultRoot(): string {
  return process.env.VAULT_PATH ?? path.join(process.cwd(), '../../vault');
}

interface RouteContext {
  params: { path?: string[] };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const vaultRoot = getVaultRoot();
  const segments = params.path ?? [];
  const fsPath = path.join(vaultRoot, ...segments);

  const resolvedPath = path.resolve(fsPath);
  const resolvedRoot = path.resolve(vaultRoot);
  if (!resolvedPath.startsWith(resolvedRoot)) {
    return new NextResponse('Not found', { status: 404 });
  }

  let targetPath = resolvedPath;

  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return new NextResponse('Cannot download a directory', { status: 400 });
    }
  } catch {
    const mdPath = resolvedPath + '.md';
    try {
      const stat = fs.statSync(mdPath);
      if (stat.isDirectory()) {
        return new NextResponse('Cannot download a directory', { status: 400 });
      }
      targetPath = mdPath;
    } catch {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(targetPath);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const filename = path.basename(targetPath);

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}

