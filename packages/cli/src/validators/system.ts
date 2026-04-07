import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { run } from '../utils/exec.js';
import type { DoctorCheckResult } from '../types.js';

const MIN_DISK_GB = 5;

export async function checkDiskSpace(): Promise<DoctorCheckResult> {
  try {
    let freeGB: number;
    if (platform() === 'win32') {
      // Windows — skip, report warning
      return {
        id: 'disk-space',
        title: `Disk space >= ${MIN_DISK_GB} GB`,
        status: 'warn',
        what: 'Cannot check disk space on Windows',
        critical: true,
      };
    }

    const result = execSync('df -BG . 2>/dev/null || df -g . 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = result.trim().split('\n');
    const parts = lines[lines.length - 1]?.split(/\s+/) ?? [];
    // Available space is typically the 4th column
    const availStr = parts[3] ?? '0';
    freeGB = parseInt(availStr.replace(/G$/i, ''), 10);

    if (freeGB >= MIN_DISK_GB) {
      return {
        id: 'disk-space',
        title: `Disk space >= ${MIN_DISK_GB} GB`,
        status: 'pass',
        what: `${freeGB} GB available`,
        critical: true,
      };
    }

    return {
      id: 'disk-space',
      title: `Disk space >= ${MIN_DISK_GB} GB`,
      status: 'fail',
      what: `Only ${freeGB} GB available`,
      why: `YCLAW needs at least ${MIN_DISK_GB} GB free`,
      fix: 'Free up disk space',
      critical: true,
    };
  } catch {
    return {
      id: 'disk-space',
      title: `Disk space >= ${MIN_DISK_GB} GB`,
      status: 'warn',
      what: 'Could not determine disk space',
      critical: true,
    };
  }
}

export async function checkPortAvailable(port: number): Promise<DoctorCheckResult> {
  const id = `port-${port}`;
  const title = `Port ${port} available`;

  try {
    let result;
    if (platform() === 'darwin') {
      result = await run('lsof', ['-i', `:${port}`, '-sTCP:LISTEN']);
    } else {
      result = await run('ss', ['-tlnp', `sport = :${port}`]);
    }

    // Command not found (exit 127) — warn, don't false-pass (M10)
    if (result.exitCode === 127) {
      return {
        id, title,
        status: 'warn',
        what: `Cannot check port ${port}`,
        why: 'lsof/ss not found on this system',
        fix: 'Install lsof (macOS) or iproute2 (Linux)',
        critical: false,
      };
    }

    // If the command found a listener, port is in use
    const cmdOutput = result.stdout.trim();
    const hasListeners = cmdOutput.split('\n').length > 1;

    if (!hasListeners) {
      return { id, title, status: 'pass', what: `Port ${port} is free`, critical: true };
    }

    return {
      id, title,
      status: 'fail',
      what: `Port ${port} is in use`,
      why: `Another process is listening on port ${port}`,
      fix: `Stop the process using port ${port} or change the port in .env`,
      critical: true,
    };
  } catch {
    return {
      id, title,
      status: 'warn',
      what: `Could not check port ${port}`,
      critical: false,
    };
  }
}
