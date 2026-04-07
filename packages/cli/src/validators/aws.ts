/**
 * AWS-specific doctor checks — Terraform CLI, AWS CLI, credentials.
 */

import type { DoctorCheckResult } from '../types.js';
import { run } from '../utils/exec.js';

/** Check Terraform CLI is installed and >= 1.5.0 */
export async function checkTerraformInstalled(): Promise<DoctorCheckResult> {
  const result = await run('terraform', ['version', '-json']);

  if (result.exitCode === 127) {
    return {
      id: 'terraform-installed',
      title: 'Terraform CLI',
      status: 'fail',
      what: 'Terraform is not installed',
      why: 'Required for AWS deployment',
      fix: 'Install from https://developer.hashicorp.com/terraform/install',
      critical: true,
    };
  }

  if (result.exitCode !== 0) {
    return {
      id: 'terraform-installed',
      title: 'Terraform CLI',
      status: 'fail',
      what: 'Terraform version check failed',
      why: result.stderr,
      fix: 'Reinstall Terraform',
      critical: true,
    };
  }

  try {
    const info = JSON.parse(result.stdout) as { terraform_version: string };
    const version = info.terraform_version;
    const [major, minor] = version.split('.').map(Number);
    if ((major ?? 0) < 1 || ((major ?? 0) === 1 && (minor ?? 0) < 5)) {
      return {
        id: 'terraform-installed',
        title: 'Terraform CLI',
        status: 'fail',
        what: `Terraform ${version} found, >= 1.5.0 required`,
        fix: 'Upgrade Terraform: https://developer.hashicorp.com/terraform/install',
        critical: true,
      };
    }

    return {
      id: 'terraform-installed',
      title: 'Terraform CLI',
      status: 'pass',
      what: `Terraform ${version}`,
      critical: true,
    };
  } catch {
    // Fallback for non-JSON terraform version output
    return {
      id: 'terraform-installed',
      title: 'Terraform CLI',
      status: 'pass',
      what: 'Terraform installed (version check skipped)',
      critical: true,
    };
  }
}

/** Check AWS CLI is installed */
export async function checkAwsCli(): Promise<DoctorCheckResult> {
  const result = await run('aws', ['--version']);

  if (result.exitCode !== 0) {
    return {
      id: 'aws-cli',
      title: 'AWS CLI',
      status: 'fail',
      what: result.exitCode === 127 ? 'AWS CLI is not installed' : 'AWS CLI check failed',
      why: result.exitCode === 127
        ? 'Required for AWS deployment and ECS service status checks'
        : result.stderr || `aws --version exited with code ${result.exitCode}`,
      fix: 'Install from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
      critical: true,
    };
  }

  const version = (result.stdout || result.stderr).trim().split('\n')[0] ?? '';
  return {
    id: 'aws-cli',
    title: 'AWS CLI',
    status: 'pass',
    what: version || 'AWS CLI installed',
    critical: true,
  };
}

/** Check AWS credentials are configured */
export async function checkAwsCredentials(): Promise<DoctorCheckResult> {
  const result = await run('aws', ['sts', 'get-caller-identity', '--output', 'json']);

  if (result.exitCode !== 0) {
    return {
      id: 'aws-credentials',
      title: 'AWS credentials',
      status: 'fail',
      what: 'AWS credentials not configured or expired',
      why: result.stderr || 'aws sts get-caller-identity failed',
      fix: 'Run: aws configure  OR  set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY',
      critical: true,
    };
  }

  try {
    const identity = JSON.parse(result.stdout) as { Account: string; Arn: string };
    return {
      id: 'aws-credentials',
      title: 'AWS credentials',
      status: 'pass',
      what: `Account ${identity.Account}`,
      critical: true,
    };
  } catch {
    return {
      id: 'aws-credentials',
      title: 'AWS credentials',
      status: 'pass',
      what: 'AWS credentials valid',
      critical: true,
    };
  }
}
