import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireSession, checkTier } from '@/lib/require-permission';

const REPO_OWNER = 'your-org';
const REPO_NAME = 'yclaw';

// Files that agents cannot self-modify (but humans CAN edit here)
const AGENT_PROTECTED = ['mission_statement.md', 'review-rules.md'];

// Allowlist: only filenames matching this pattern are accessible.
// Must end in .md, no slashes/dots-before-extension (prevents path traversal).
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.md$/;

interface RouteContext {
  params: { filename: string };
}

function validateFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename) && !filename.includes('..');
}

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return NextResponse.json({ error: 'GitHub token not configured' }, { status: 503 });
  }

  const { filename } = params;
  if (!validateFilename(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const path = `prompts/${filename}`;

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
      next: { revalidate: 60 },
    }
  );

  if (!res.ok) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');

  return NextResponse.json({
    filename,
    content,
    sha: data.sha,
    path: data.path,
    agentProtected: AGENT_PROTECTED.includes(filename),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: RouteContext
) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  // Writing to GitHub repo requires root
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return NextResponse.json({ error: 'GitHub token not configured' }, { status: 503 });
  }

  const { filename } = params;
  if (!validateFilename(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  let body: { content?: unknown; sha?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { content, sha, message } = body;
  if (typeof content !== 'string' || typeof sha !== 'string') {
    return NextResponse.json({ error: 'content (string) and sha (string) are required' }, { status: 400 });
  }

  const path = `prompts/${filename}`;

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: (typeof message === 'string' && message) || `Update ${filename} via Mission Control`,
        content: Buffer.from(content).toString('base64'),
        sha,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err.message }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({
    success: true,
    newSha: data.content.sha,
    commitUrl: data.commit.html_url,
  });
}
