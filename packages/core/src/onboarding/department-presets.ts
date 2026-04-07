/**
 * Department preset definitions.
 *
 * These provide sensible defaults for common organizational departments.
 * Users can select, customize, or skip any preset during onboarding.
 */

import type { DepartmentPreset } from './types.js';
import type { DepartmentName } from './constants.js';

const PRESETS: Record<DepartmentName, DepartmentPreset> = {
  development: {
    name: 'Development',
    description: 'Software development, architecture, code review, and technical infrastructure.',
    charter: 'Deliver high-quality, well-tested code. Maintain system reliability. Review all changes before merge.',
    agents: ['architect', 'builder'],
    recurringTasks: [
      'Review open pull requests daily',
      'Monitor CI/CD pipeline health',
      'Update dependency versions weekly',
    ],
    escalationRules: [
      'CI failure unresolved for 30 minutes → alert ops channel',
      'PR open without review for 24 hours → notify department head',
    ],
  },
  marketing: {
    name: 'Marketing',
    description: 'Content creation, social media, community engagement, and brand management.',
    charter: 'Create engaging content aligned with brand voice. Grow community presence. All external content must pass review.',
    agents: ['ember', 'forge', 'scout'],
    recurringTasks: [
      'Draft weekly social media content',
      'Monitor community channels for engagement opportunities',
      'Compile weekly engagement metrics',
    ],
    escalationRules: [
      'Content flagged by safety filter → hold for human review',
      'Negative sentiment spike → alert executive department',
    ],
  },
  operations: {
    name: 'Operations',
    description: 'System monitoring, incident response, infrastructure management, and process optimization.',
    charter: 'Keep systems running. Detect and respond to incidents. Maintain operational documentation.',
    agents: ['sentinel'],
    recurringTasks: [
      'System health check every 15 minutes',
      'Daily infrastructure status report',
      'Weekly capacity planning review',
    ],
    escalationRules: [
      'System health check failure → immediate alert',
      'Resource utilization above 80% → alert within 1 hour',
    ],
  },
  support: {
    name: 'Support',
    description: 'User support, documentation maintenance, knowledge base management, and issue triage.',
    charter: 'Help users efficiently. Maintain accurate documentation. Triage and route issues to correct departments.',
    agents: ['guide', 'keeper'],
    recurringTasks: [
      'Respond to new support requests within 1 hour',
      'Update FAQ based on common questions weekly',
      'Review and update documentation monthly',
    ],
    escalationRules: [
      'Support request unanswered for 2 hours → escalate to department head',
      'Bug report confirmed → create issue in Development',
    ],
  },
  executive: {
    name: 'Executive',
    description: 'Strategic planning, cross-department coordination, goal tracking, and organizational governance.',
    charter: 'Set direction. Coordinate departments. Track progress against priorities. Make governance decisions.',
    agents: ['strategist', 'reviewer'],
    recurringTasks: [
      'Daily standup synthesis across departments',
      'Weekly progress report against priorities',
      'Monthly strategic review',
    ],
    escalationRules: [
      'Cross-department conflict → mediate within 4 hours',
      'Priority blocked for 48 hours → executive review',
    ],
  },
  finance: {
    name: 'Finance',
    description: 'Cost tracking, budget management, spending analysis, and financial reporting.',
    charter: 'Track and optimize AI spending. Maintain budget visibility. Alert on cost anomalies.',
    agents: ['treasurer'],
    recurringTasks: [
      'Daily cost summary report',
      'Weekly budget vs actual analysis',
      'Monthly spending trend report',
    ],
    escalationRules: [
      'Daily spend exceeds budget by 20% → immediate alert',
      'New high-cost model usage detected → flag for review',
    ],
  },
};

/** Get a department preset by name. */
export function getDepartmentPreset(name: DepartmentName): DepartmentPreset {
  return PRESETS[name];
}

/** Get all department presets. */
export function getAllDepartmentPresets(): Record<DepartmentName, DepartmentPreset> {
  return { ...PRESETS };
}

/** Get preset names. */
export function getDepartmentPresetNames(): DepartmentName[] {
  return Object.keys(PRESETS) as DepartmentName[];
}
