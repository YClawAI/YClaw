import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function trackedFiles(): string[] {
  return execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function readTracked(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

const PUBLIC_SURFACE = [
  /^\.env\.example$/,
  /^\.github\//,
  /^deploy\//,
  /^departments\//,
  /^docs\//,
  /^infra\//,
  /^prompts\//,
  /^scripts\//,
  /^terraform\//,
];

const EXCLUDED_FILES = new Set([
  'package-lock.json',
  'ao/package-lock.json',
]);

function isPublicSurface(path: string): boolean {
  return PUBLIC_SURFACE.some(pattern => pattern.test(path)) && !EXCLUDED_FILES.has(path);
}

describe('public release readiness', () => {
  it('does not ship Troy deployment IDs in public config, docs, prompts, or infra helpers', () => {
    const patterns = [
      {
        label: 'AWS account ID',
        regex: /(?<![A-Za-z0-9])[0-9]{12}(?![A-Za-z0-9])/g,
        allowed: (value: string) => value === '123456789012',
      },
      {
        label: 'Discord channel or guild ID',
        regex: /(?<![A-Za-z0-9])[0-9]{17,19}(?![A-Za-z0-9])/g,
        allowed: () => false,
      },
      {
        label: 'AWS VPC/security group/subnet ID',
        regex: /(?<![A-Za-z0-9])(?:vpc|sg|subnet)-[0-9a-f]{8,17}(?![A-Za-z0-9])/g,
        allowed: () => false,
      },
      {
        label: 'private or Tailscale IP address',
        regex: /(?<![0-9])(?:10\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+)(?![0-9])/g,
        allowed: (_value: string, content: string, index: number) => content[index + _value.length] === '/',
      },
    ];

    const violations: string[] = [];
    for (const file of trackedFiles().filter(isPublicSurface)) {
      const content = readTracked(file);
      for (const { label, regex, allowed } of patterns) {
        regex.lastIndex = 0;
        for (const match of content.matchAll(regex)) {
          const value = match[0];
          if (!allowed(value, content, match.index ?? 0)) {
            violations.push(`${file}: ${label}: ${value}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not keep active Strategist publications for deleted Builder/Deployer agents', () => {
    const strategist = YAML.parse(readTracked('departments/executive/strategist.yaml')) as {
      event_publications?: string[];
    };
    const legacyPublications = (strategist.event_publications ?? []).filter(event =>
      /builder|deployer/i.test(event),
    );

    expect(legacyPublications).toEqual([]);

    const objectives = readTracked('prompts/strategist-objectives.md');
    expect(objectives).not.toMatch(/\b(?:builder|deployer)_directive\b/i);
    expect(objectives).not.toMatch(/\bBuilder DLQ\b/i);
  });
});
