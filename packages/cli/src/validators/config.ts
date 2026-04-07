/**
 * Config schema validation wrapper.
 */

import type { DoctorCheckResult } from '../types.js';
import { loadConfig } from '../utils/load-config.js';

export async function checkConfigValid(dir: string = '.'): Promise<DoctorCheckResult> {
  try {
    await loadConfig(dir);
    return {
      id: 'config-valid',
      title: 'yclaw.config.yaml valid',
      status: 'pass',
      what: 'Config file validates against schema',
      critical: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: 'config-valid',
      title: 'yclaw.config.yaml valid',
      status: 'fail',
      what: 'Config validation failed',
      why: msg,
      fix: 'Run: yclaw init --force',
      critical: true,
    };
  }
}
