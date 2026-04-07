import { describe, it, expect } from 'vitest';
import { HardGateRunner } from '../src/safety/hard-gate-runner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal unified diff string with a single added line in the given file. */
function makeDiff(file: string, addedLine: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,2 @@`,
    ` context line`,
    `+${addedLine}`,
  ].join('\n');
}

const runner = new HardGateRunner();

// ─── Gate 5: IAM Privilege Escalation ────────────────────────────────────────

describe('HardGateRunner — Gate 5: iam-privilege-escalation', () => {
  // ── Blocked: aws iam write verbs in .sh files ──

  it('blocks aws iam create- in a .sh file', () => {
    const result = runner.run(makeDiff('deploy.sh', '  aws iam create-role --role-name MyRole --assume-role-policy-document file://trust.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations).toHaveLength(1);
    expect(gate.violations[0].pattern).toBe('iam-create-operation');
    expect(gate.violations[0].severity).toBe('BLOCK');
    expect(result.passed).toBe(false);
  });

  it('blocks aws iam attach- in a .yml file', () => {
    const result = runner.run(makeDiff('.github/workflows/deploy.yml', '        run: aws iam attach-role-policy --role-name MyRole --policy-arn arn:aws:iam::aws:policy/AdministratorAccess'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-attach-operation');
  });

  it('blocks aws iam detach- in a .yaml file', () => {
    const result = runner.run(makeDiff('infra/roles.yaml', 'aws iam detach-role-policy --role-name MyRole --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-detach-operation');
  });

  it('blocks aws iam put- in a .sh file', () => {
    const result = runner.run(makeDiff('scripts/setup.sh', 'aws iam put-role-policy --role-name MyRole --policy-name inline-policy --policy-document file://policy.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-put-operation');
  });

  it('blocks aws iam delete- in a .yml file', () => {
    const result = runner.run(makeDiff('ci/cleanup.yml', 'aws iam delete-role --role-name OldRole'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-delete-operation');
  });

  it('blocks aws iam add- in a .sh file', () => {
    const result = runner.run(makeDiff('bootstrap.sh', 'aws iam add-user-to-group --user-name bob --group-name admins'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-add-operation');
  });

  it('blocks aws iam update- in a .yaml file', () => {
    const result = runner.run(makeDiff('pipeline.yaml', 'aws iam update-assume-role-policy --role-name MyRole --policy-document file://new-trust.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-update-operation');
  });

  // ── Allowed: read-only aws iam commands ──

  it('allows aws iam get- (read-only)', () => {
    const result = runner.run(makeDiff('check.sh', 'aws iam get-role --role-name MyRole'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });

  it('allows aws iam list- (read-only)', () => {
    const result = runner.run(makeDiff('audit.sh', 'aws iam list-roles --query "Roles[*].RoleName"'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });

  // ── Blocked: aws iam with global flags (regression: previously bypassed the gate) ──

  it('blocks aws iam create- with --region global flag in a .sh file', () => {
    const result = runner.run(makeDiff('deploy.sh', 'aws --region us-east-1 iam create-role --role-name Evil --assume-role-policy-document file://trust.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-create-operation');
  });

  it('blocks aws iam attach- with multiple global flags in a .yml file', () => {
    const result = runner.run(makeDiff('.github/workflows/deploy.yml', 'run: aws --profile prod --region eu-west-1 iam attach-role-policy --role-name MyRole --policy-arn arn:aws:iam::aws:policy/AdministratorAccess'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-attach-operation');
  });

  // ── Blocked: expanded file scope ──

  it('blocks aws iam create- in a Dockerfile', () => {
    const result = runner.run(makeDiff('Dockerfile', 'RUN aws iam create-role --role-name CiRole --assume-role-policy-document file://trust.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-create-operation');
  });

  it('blocks aws iam create- in a nested Dockerfile', () => {
    const result = runner.run(makeDiff('services/api/Dockerfile', 'RUN aws iam create-role --role-name SvcRole --assume-role-policy-document file://trust.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-create-operation');
  });

  it('blocks aws iam put- in a Makefile', () => {
    const result = runner.run(makeDiff('Makefile', '\taws iam put-role-policy --role-name MyRole --policy-name inline --policy-document file://policy.json'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('iam-put-operation');
  });

  // ── Blocked: aws sts assume-role ──

  it('blocks aws sts assume-role in a .sh file', () => {
    const result = runner.run(makeDiff('scripts/assume.sh', 'aws sts assume-role --role-arn arn:aws:iam::123456789012:role/PrivRole --role-session-name ci'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('sts-assume-role');
  });

  it('blocks aws sts assume-role in a .yml file', () => {
    const result = runner.run(makeDiff('.github/workflows/ci.yml', '        run: aws sts assume-role --role-arn arn:aws:iam::123456789012:role/EvilRole --role-session-name s'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('sts-assume-role');
  });

  it('blocks aws sts assume-role in a .yaml file', () => {
    const result = runner.run(makeDiff('pipeline.yaml', 'aws sts assume-role --role-arn arn:aws:iam::123456789012:role/PrivRole --role-session-name s'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('sts-assume-role');
  });

  it('blocks aws sts assume-role with global flags in a .sh file', () => {
    const result = runner.run(makeDiff('assume.sh', 'aws --region us-east-1 sts assume-role --role-arn arn:aws:iam::123456789012:role/Admin --role-session-name ci'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('sts-assume-role');
  });

  // ── Blocked: CloudFormation CAPABILITY_IAM ──

  it('blocks CAPABILITY_IAM in a .yml file', () => {
    const result = runner.run(makeDiff('.github/workflows/deploy.yml', '        run: aws cloudformation deploy --capabilities CAPABILITY_IAM --stack-name mystack --template-file template.yml'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('cfn-capability-iam');
  });

  it('blocks CAPABILITY_NAMED_IAM in a .yaml file', () => {
    const result = runner.run(makeDiff('pipeline.yaml', 'capabilities: CAPABILITY_NAMED_IAM'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('cfn-capability-iam');
  });

  it('blocks CAPABILITY_IAM in a .sh file', () => {
    const result = runner.run(makeDiff('deploy.sh', 'aws cloudformation deploy --capabilities CAPABILITY_IAM --stack-name stack'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('cfn-capability-iam');
  });

  // ── Blocked: Terraform IAM resource declarations ──

  it('blocks resource "aws_iam_role" in a .tf file', () => {
    const result = runner.run(makeDiff('infra/roles.tf', 'resource "aws_iam_role" "ci_role" {'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('tf-iam-resource');
  });

  it('blocks resource "aws_iam_policy" in a .tf file', () => {
    const result = runner.run(makeDiff('terraform/iam.tf', 'resource "aws_iam_policy" "allow_s3" {'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('tf-iam-resource');
  });

  it('blocks resource "aws_iam_role_policy_attachment" in a .tf file', () => {
    const result = runner.run(makeDiff('infra/main.tf', '  resource "aws_iam_role_policy_attachment" "attach" {'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(false);
    expect(gate.violations[0].pattern).toBe('tf-iam-resource');
  });

  // ── Not scanned: non-.sh/.yml/.yaml/.tf/Dockerfile/Makefile files ──

  it('does not scan aws iam write commands in .ts files', () => {
    const result = runner.run(makeDiff('src/deploy.ts', "const cmd = 'aws iam create-role --role-name Test';"));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });

  it('does not scan aws iam CLI commands in .tf files (only terraform resource declarations are checked)', () => {
    const result = runner.run(makeDiff('infra/main.tf', '  command = "aws iam attach-role-policy ..."'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });

  it('does not scan aws iam write commands in .md files', () => {
    const result = runner.run(makeDiff('docs/guide.md', 'Run `aws iam create-role` to set up the role.'));
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });

  // ── Violation structure ──

  it('includes file, line, and snippet in the violation', () => {
    const diff = makeDiff('deploy.sh', 'aws iam create-user --user-name ci-agent');
    const result = runner.run(diff);
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    const [v] = gate.violations;
    expect(v.file).toBe('deploy.sh');
    expect(v.line).toBeGreaterThan(0);
    expect(v.snippet).toContain('aws iam create-user');
    expect(v.severity).toBe('BLOCK');
  });

  // ── Gate 5 is included in result.gates ──

  it('always includes iam-privilege-escalation in result.gates', () => {
    const result = runner.run('');
    expect(result.gates.map(g => g.name)).toContain('iam-privilege-escalation');
  });

  it('passes cleanly on an empty diff', () => {
    const result = runner.run('');
    const gate = result.gates.find(g => g.name === 'iam-privilege-escalation')!;
    expect(gate.passed).toBe(true);
    expect(gate.violations).toHaveLength(0);
  });
});
