import type { DoctorCheckResult } from '../types.js';

const MIN_NODE_VERSION = 20;

export function checkNodeVersion(): DoctorCheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0] ?? '0', 10);

  if (major >= MIN_NODE_VERSION) {
    return {
      id: 'node-version',
      title: `Node.js >= ${MIN_NODE_VERSION}`,
      status: 'pass',
      what: `Node.js ${version}`,
      critical: true,
    };
  }

  return {
    id: 'node-version',
    title: `Node.js >= ${MIN_NODE_VERSION}`,
    status: 'fail',
    what: `Node.js ${version} is below minimum`,
    why: `YCLAW requires Node.js ${MIN_NODE_VERSION}+`,
    fix: `Install Node.js ${MIN_NODE_VERSION}+ from https://nodejs.org`,
    critical: true,
  };
}
