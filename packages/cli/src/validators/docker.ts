import { run } from '../utils/exec.js';
import type { DoctorCheckResult } from '../types.js';

export async function checkDockerInstalled(): Promise<DoctorCheckResult> {
  const result = await run('docker', ['info']);

  if (result.exitCode === 0) {
    return {
      id: 'docker-installed',
      title: 'Docker available',
      status: 'pass',
      what: 'Docker is installed and running',
      critical: true,
    };
  }

  return {
    id: 'docker-installed',
    title: 'Docker available',
    status: 'fail',
    what: 'Docker is not available',
    why: result.exitCode === 127
      ? 'Docker is not installed'
      : 'Docker daemon is not running',
    fix: 'Install Docker Desktop from https://docker.com',
    critical: true,
  };
}

export async function checkDockerCompose(): Promise<DoctorCheckResult> {
  // Try docker compose v2 first (plugin)
  let result = await run('docker', ['compose', 'version']);
  if (result.exitCode === 0) {
    const version = result.stdout.trim();
    return {
      id: 'docker-compose',
      title: 'Docker Compose v2+',
      status: 'pass',
      what: version,
      critical: true,
    };
  }

  // Fall back to standalone docker-compose v1
  result = await run('docker-compose', ['--version']);
  if (result.exitCode === 0) {
    return {
      id: 'docker-compose',
      title: 'Docker Compose v2+',
      status: 'warn',
      what: result.stdout.trim(),
      why: 'docker-compose v1 detected — v2 recommended',
      fix: 'Upgrade Docker Desktop or install compose v2 plugin',
      critical: true,
    };
  }

  return {
    id: 'docker-compose',
    title: 'Docker Compose v2+',
    status: 'fail',
    what: 'Docker Compose not found',
    why: 'Neither docker compose (v2) nor docker-compose (v1) found',
    fix: 'Install Docker Desktop (includes Compose v2)',
    critical: true,
  };
}
