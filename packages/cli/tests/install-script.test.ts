import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const INSTALL_SCRIPT = resolve(REPO_ROOT, 'install.sh');

describe('install.sh bootstrap contract', () => {
  it('exists as an executable root bootstrap script', () => {
    const mode = statSync(INSTALL_SCRIPT).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it('clones, builds the local CLI, runs doctor before deploy, and uses deploy only after a passing doctor', () => {
    const script = readFileSync(INSTALL_SCRIPT, 'utf8');

    expect(script).toContain('git clone');
    expect(script).toContain('npm ci');
    expect(script).toContain('npm run build --workspace=packages/cli');
    expect(script).toContain('npx --no-install yclaw init');
    expect(script).toContain('npx --no-install yclaw doctor');
    expect(script).toContain('npx --no-install yclaw deploy');

    const doctorIndex = script.indexOf('npx --no-install yclaw doctor');
    const deployIndex = script.indexOf('npx --no-install yclaw deploy');
    expect(doctorIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(doctorIndex);
    expect(script).toContain('doctor must pass before deployment');
  });
});
