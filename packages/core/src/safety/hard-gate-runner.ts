import { createLogger } from '../logging/logger.js';

const logger = createLogger('hard-gate-runner');

// ─── Hard Gate Types ─────────────────────────────────────────────────────────

export interface HardGateViolation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;   // offending line, redacted if a secret value
  severity: 'BLOCK';
}

export interface HardGateSubResult {
  name: 'secrets' | 'infra-destruction' | 'cicd-tamper' | 'security-regression' | 'iam-privilege-escalation';
  passed: boolean;
  violations: HardGateViolation[];
}

export interface HardGateResult {
  passed: boolean;
  gates: HardGateSubResult[];
}

// ─── Diff Line ───────────────────────────────────────────────────────────────

interface DiffLine {
  file: string;
  line: number;
  content: string;
}

// ─── Entropy Helpers ─────────────────────────────────────────────────────────

/** Shannon entropy of a string (bits per character). */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Returns true if the string looks like a high-entropy secret assignment. */
function isHighEntropyAssignment(line: string): boolean {
  // Only check assignment contexts: =, :, "key": "value", etc.
  if (!/[=:]\s*["']?[A-Za-z0-9+/\-_]{32,}["']?/.test(line)) return false;

  // Extract candidate value (alphanum+base64 chars, 32+ long)
  const match = line.match(/["']?([A-Za-z0-9+/\-_]{32,})["']?/);
  if (!match) return false;

  const candidate = match[1];

  // Skip obvious non-secrets (repeated chars, version strings, UUIDs without dashes)
  if (/^(.)\1{10,}/.test(candidate)) return false;
  if (/^\d+\.\d+\.\d+/.test(candidate)) return false;

  return shannonEntropy(candidate) > 4.5;
}

// ─── Gate Pattern Definitions ─────────────────────────────────────────────────

// Gate 1: Secret / Credential Patterns
const SECRET_PATTERNS: Array<{ regex: RegExp; name: string; redact: boolean }> = [
  { regex: /AKIA[0-9A-Z]{16}/, name: 'aws-access-key', redact: true },
  { regex: /ASIA[0-9A-Z]{16}/, name: 'aws-session-key', redact: true },
  { regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, name: 'private-key-pem', redact: true },
  { regex: /gh[ps]_[A-Za-z0-9_]{36,}/, name: 'github-token', redact: true },
  { regex: /github_pat_[A-Za-z0-9_]{22,}/, name: 'github-fine-grained-pat', redact: true },
  { regex: /xox[baprs]-[A-Za-z0-9-]+/, name: 'slack-token', redact: true },
  // .env/.pem/.key files with literal values (not SSM/Secrets Manager refs)
  { regex: /^[A-Z_]+=(?!\$\{(SSM|sm|secrets):)[^\s$][^\s]+$/, name: 'env-literal-secret', redact: true },
];

// Gate 2: Infrastructure Destruction Patterns
const INFRA_DESTRUCTION_PATTERNS: Array<{ regex: RegExp; name: string; fileFilter?: RegExp }> = [
  // Terraform destroy on stateful resources
  { regex: /resource\s+"aws_rds_cluster"\s+|resource\s+"aws_db_instance"\s+/, name: 'tf-rds-modified', fileFilter: /\.tf$/ },
  { regex: /resource\s+"aws_vpc"\s+/, name: 'tf-vpc-modified', fileFilter: /\.tf$/ },
  { regex: /resource\s+"aws_s3_bucket"\s+/, name: 'tf-s3-bucket-modified', fileFilter: /\.tf$/ },
  // Scale to zero on production
  { regex: /desired_count\s*=\s*0/, name: 'ecs-scale-to-zero', fileFilter: /\.tf$|\.yaml$|\.yml$/ },
  { regex: /min_capacity\s*=\s*0/, name: 'autoscaling-min-zero', fileFilter: /\.tf$/ },
  // IAM wildcard expansion
  { regex: /"Action"\s*:\s*"\*"/, name: 'iam-action-wildcard' },
  { regex: /"Resource"\s*:\s*"\*"/, name: 'iam-resource-wildcard' },
  // Open security group ingress on sensitive ports
  { regex: /cidr_blocks\s*=\s*\[?\s*"0\.0\.0\.0\/0"/, name: 'open-cidr-ingress', fileFilter: /\.tf$/ },
  { regex: /from_port\s*=\s*(22|3389|5432|3306|6379|27017)\b/, name: 'sensitive-port-exposed', fileFilter: /\.tf$/ },
];

// Gate 3: CI/CD Tampering Patterns (.github/workflows files)
const CICD_TAMPER_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  // Unpinned GitHub Actions (uses: owner/repo@v1 instead of @sha)
  { regex: /uses:\s+[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+@(?![\da-f]{40}\b)[^\s]+/, name: 'unpinned-action' },
  // Broad write-all permissions
  { regex: /permissions:\s*write-all/, name: 'permissions-write-all' },
  { regex: /permissions:\s*\n\s+\w+:\s*write/, name: 'broad-permissions' },
  // pull_request_target without strict filters
  { regex: /on:\s*[\s\S]*?pull_request_target/, name: 'pull-request-target' },
  // Remote script execution
  { regex: /curl\s+.*\|\s*(bash|sh)/, name: 'curl-pipe-shell' },
  { regex: /wget\s+.*\|\s*(bash|sh)/, name: 'wget-pipe-shell' },
  // Self-modifying workflow
  { regex: /\.github\/workflows\/.*\.ya?ml/, name: 'self-modifying-workflow' },
];

// Gate 5: IAM Privilege Escalation Patterns
// Blocks aws iam write operations in shell, workflow, Dockerfile, and Makefile files.
// The yclaw-landing deploy role is scoped to S3/CloudFront static-site ops only.
// IAM mutations must go through the approved infra change path (see docs/security.md).
//
// Accepted risks (hard to catch with regex):
//   - Shell obfuscation (eval, base64, variable interpolation)
//   - Cross-repo indirect escalation (out of scope for this gate)
const IAM_WRITE_COMMANDS: Array<{ regex: RegExp; name: string; fileFilter?: RegExp }> = [
  // aws iam write operations — regex handles intervening global flags (e.g. --region, --profile)
  { regex: /aws\s+(?:\S+\s+)*iam\s+create-/, name: 'iam-create-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+attach-/, name: 'iam-attach-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+detach-/, name: 'iam-detach-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+put-/, name: 'iam-put-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+delete-/, name: 'iam-delete-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+add-/, name: 'iam-add-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+remove-/, name: 'iam-remove-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+update-/, name: 'iam-update-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+set-/, name: 'iam-set-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+tag-/, name: 'iam-tag-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+untag-/, name: 'iam-untag-operation' },
  { regex: /aws\s+(?:\S+\s+)*iam\s+upload-/, name: 'iam-upload-operation' },
  // aws sts assume-role: hop to a more privileged role
  { regex: /aws\s+(?:\S+\s+)*sts\s+assume-role\b/, name: 'sts-assume-role' },
  // CloudFormation capabilities that grant IAM mutations via CFN stack execution
  { regex: /CAPABILITY_(?:NAMED_)?IAM\b/, name: 'cfn-capability-iam' },
  // Terraform IAM resource declarations (.tf only — CLI patterns are not matched in .tf files)
  { regex: /resource\s+"aws_iam_/, name: 'tf-iam-resource', fileFilter: /\.tf$/ },
];

// Gate 4: Security Regression Patterns
const SECURITY_REGRESSION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  // Auth bypass flags
  { regex: /SKIP_AUTH\s*[=:]\s*(true|1|yes)/i, name: 'skip-auth-flag' },
  { regex: /DISABLE_AUTH\s*[=:]\s*(true|1|yes)/i, name: 'disable-auth-flag' },
  { regex: /AUTH_BYPASS\s*[=:]\s*(true|1|yes)/i, name: 'auth-bypass-flag' },
  { regex: /skipAuth\s*[:=]\s*true/, name: 'skip-auth-code' },
  { regex: /bypassAuth\s*[:=]\s*true/, name: 'bypass-auth-code' },
  // TLS/SSL disabled
  { regex: /rejectUnauthorized\s*:\s*false/, name: 'tls-reject-unauthorized-disabled' },
  { regex: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/, name: 'node-tls-disabled' },
  { regex: /verify\s*=\s*False/i, name: 'ssl-verify-disabled' },
  // Container privilege escalation
  { regex: /privileged\s*:\s*true/, name: 'container-privileged' },
  { regex: /runAsUser\s*:\s*0\b/, name: 'container-run-as-root' },
  { regex: /CAP_SYS_ADMIN/, name: 'cap-sys-admin' },
  // Encryption disabled
  { regex: /encryption_disabled\s*[=:]\s*(true|1)/i, name: 'encryption-disabled' },
  { regex: /StorageEncrypted\s*:\s*false/, name: 'rds-encryption-disabled' },
];

// ─── HardGateRunner ──────────────────────────────────────────────────────────

/**
 * Deterministic hard gate scanner for CRITICAL-tier deployment diffs.
 *
 * No LLM involved — pure regex + entropy analysis.
 * Runs in <30s on typical PR diffs.
 *
 * Input: unified diff string (concatenated patch fields from GitHub Compare API).
 * Output: HardGateResult with per-gate pass/fail + structured violations.
 */
export class HardGateRunner {
  /**
   * Run all 5 hard gates against a unified diff string.
   *
   * @param diffPatches - Concatenated unified diff (from GitHub compare API patch fields).
   *                      Can also be a plain diff_summary if patches unavailable —
   *                      gates will run on whatever content is provided.
   * @returns HardGateResult — passed=true only if ALL 5 gates pass.
   */
  run(diffPatches: string): HardGateResult {
    const lines = this.parseDiffLines(diffPatches);

    const secretsResult = this.runSecretsGate(lines);
    const infraResult = this.runInfraDestructionGate(lines);
    const cicdResult = this.runCicdTamperGate(lines);
    const secRegResult = this.runSecurityRegressionGate(lines);
    const iamResult = this.runIamPrivilegeEscalationGate(lines);

    const gates: HardGateSubResult[] = [secretsResult, infraResult, cicdResult, secRegResult, iamResult];
    const passed = gates.every(g => g.passed);

    logger.info('HardGateRunner complete', {
      passed,
      totalViolations: gates.reduce((n, g) => n + g.violations.length, 0),
      gates: gates.map(g => ({ name: g.name, passed: g.passed, violations: g.violations.length })),
    });

    return { passed, gates };
  }

  // ─── Diff Parsing ─────────────────────────────────────────────────────────

  /**
   * Parse a unified diff string into a flat list of added lines with file + line metadata.
   * Only added lines (+) are checked — deletions are not security-relevant for hard gates.
   */
  private parseDiffLines(diff: string): DiffLine[] {
    const result: DiffLine[] = [];
    const rawLines = diff.split('\n');

    let currentFile = '';
    let currentLine = 0;

    for (const raw of rawLines) {
      // File header: +++ b/src/foo.ts
      if (raw.startsWith('+++ b/')) {
        currentFile = raw.slice(6).trim();
        currentLine = 0;
        continue;
      }

      // File header: +++ /dev/null (deleted file)
      if (raw.startsWith('+++ ')) {
        currentFile = raw.slice(4).trim();
        currentLine = 0;
        continue;
      }

      // Hunk header: @@ -1,4 +10,8 @@
      const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10) - 1;
        continue;
      }

      // Added line
      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        currentLine++;
        result.push({ file: currentFile, line: currentLine, content: raw.slice(1) });
        continue;
      }

      // Context line (unchanged)
      if (!raw.startsWith('-')) {
        currentLine++;
      }
      // Deleted lines don't increment new-file line counter
    }

    return result;
  }

  // ─── Gate 1: Secrets ───────────────────────────────────────────────────────

  private runSecretsGate(lines: DiffLine[]): HardGateSubResult {
    const violations: HardGateViolation[] = [];

    for (const { file, line, content } of lines) {
      // Named secret patterns
      for (const { regex, name, redact } of SECRET_PATTERNS) {
        if (regex.test(content)) {
          violations.push({
            file,
            line,
            pattern: name,
            snippet: redact ? '[REDACTED — potential secret value]' : content.slice(0, 120),
            severity: 'BLOCK',
          });
        }
      }

      // High-entropy string in assignment context (catch unknown secret patterns)
      if (isHighEntropyAssignment(content)) {
        violations.push({
          file,
          line,
          pattern: 'high-entropy-assignment',
          snippet: '[REDACTED — high-entropy string in assignment context]',
          severity: 'BLOCK',
        });
      }
    }

    return { name: 'secrets', passed: violations.length === 0, violations };
  }

  // ─── Gate 2: Infrastructure Destruction ────────────────────────────────────

  private runInfraDestructionGate(lines: DiffLine[]): HardGateSubResult {
    const violations: HardGateViolation[] = [];

    for (const { file, line, content } of lines) {
      for (const { regex, name, fileFilter } of INFRA_DESTRUCTION_PATTERNS) {
        if (fileFilter && !fileFilter.test(file)) continue;
        if (regex.test(content)) {
          violations.push({
            file,
            line,
            pattern: name,
            snippet: content.slice(0, 120),
            severity: 'BLOCK',
          });
        }
      }
    }

    return { name: 'infra-destruction', passed: violations.length === 0, violations };
  }

  // ─── Gate 3: CI/CD Tampering ───────────────────────────────────────────────

  private runCicdTamperGate(lines: DiffLine[]): HardGateSubResult {
    const violations: HardGateViolation[] = [];

    // Only scan GitHub Actions workflow files for most checks
    const cicdLines = lines.filter(l =>
      l.file.startsWith('.github/workflows/') || l.file.startsWith('.github/actions/'),
    );

    // Also scan all files for remote script execution (can appear anywhere in CI scripts)
    const allLinesForRemoteExec = lines;

    for (const { file, line, content } of cicdLines) {
      for (const { regex, name } of CICD_TAMPER_PATTERNS) {
        if (name === 'curl-pipe-shell' || name === 'wget-pipe-shell') continue; // handled below
        if (regex.test(content)) {
          violations.push({ file, line, pattern: name, snippet: content.slice(0, 120), severity: 'BLOCK' });
        }
      }
    }

    // Remote script execution check applies to all files
    for (const { file, line, content } of allLinesForRemoteExec) {
      for (const { regex, name } of CICD_TAMPER_PATTERNS) {
        if (name !== 'curl-pipe-shell' && name !== 'wget-pipe-shell') continue;
        if (regex.test(content)) {
          violations.push({ file, line, pattern: name, snippet: content.slice(0, 120), severity: 'BLOCK' });
        }
      }
    }

    return { name: 'cicd-tamper', passed: violations.length === 0, violations };
  }

  // ─── Gate 4: Security Regressions ─────────────────────────────────────────

  private runSecurityRegressionGate(lines: DiffLine[]): HardGateSubResult {
    const violations: HardGateViolation[] = [];

    for (const { file, line, content } of lines) {
      for (const { regex, name } of SECURITY_REGRESSION_PATTERNS) {
        if (regex.test(content)) {
          violations.push({ file, line, pattern: name, snippet: content.slice(0, 120), severity: 'BLOCK' });
        }
      }
    }

    return { name: 'security-regression', passed: violations.length === 0, violations };
  }

  // ─── Gate 5: IAM Privilege Escalation ─────────────────────────────────────

  /**
   * Blocks `aws iam` write operations, `aws sts assume-role`, CloudFormation IAM
   * capabilities, and Terraform IAM resource declarations.
   *
   * The yclaw-landing deploy role is scoped to S3 + CloudFront static-site operations
   * only. IAM mutations must go through the approved infra change path documented in
   * docs/security.md. Routing IAM write commands through a deploy CI workflow would
   * silently escalate those credentials beyond their intended boundary.
   *
   * General CLI scope: .sh, .yml, .yaml, Dockerfile, Makefile.
   * Patterns with an explicit fileFilter (e.g. tf-iam-resource) use that filter instead.
   *
   * Accepted risks (hard to detect with static regex):
   *   - Shell obfuscation (eval, base64, variable interpolation)
   *   - Cross-repo indirect escalation
   */
  private runIamPrivilegeEscalationGate(lines: DiffLine[]): HardGateSubResult {
    const violations: HardGateViolation[] = [];

    // General CLI scope: shell scripts, CI/CD workflows, container build files, and Makefiles.
    // .ts/.js are excluded to avoid false positives in application-code string literals;
    // SDK-level IAM calls are an accepted risk at this gate tier.
    const IAM_CLI_SCOPE = /\.(sh|yml|yaml)$|(?:^|\/)Dockerfile(\.|$)|(?:^|\/)Makefile(\.|$)/;

    for (const { file, line, content } of lines) {
      for (const { regex, name, fileFilter } of IAM_WRITE_COMMANDS) {
        // Patterns with their own fileFilter (e.g. tf-iam-resource) use that filter;
        // all other patterns use the general CLI scope.
        const effectiveFilter = fileFilter ?? IAM_CLI_SCOPE;
        if (!effectiveFilter.test(file)) continue;
        if (regex.test(content)) {
          violations.push({ file, line, pattern: name, snippet: content.slice(0, 120), severity: 'BLOCK' });
        }
      }
    }

    return { name: 'iam-privilege-escalation', passed: violations.length === 0, violations };
  }
}
