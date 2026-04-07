/**
 * Onboarding question definitions.
 *
 * Each question has a unique ID, belongs to a stage, and optionally
 * maps to an artifact that will be generated from the answer.
 */

import type { QuestionDefinition } from './types.js';

export const ONBOARDING_QUESTIONS: readonly QuestionDefinition[] = [
  // ─── Stage 1: Org Framing ──────────────────────────────────────────────
  {
    id: 'org_mission',
    stage: 'org_framing',
    prompt: 'What does your organization do?',
    helpText: 'Describe your mission, products or services, industry, and stage (startup, growth, enterprise). This helps us generate an organizational profile for your AI agents.',
    defaultAnswer: 'We are a technology company building software products.',
    artifactType: 'org_profile',
  },
  {
    id: 'org_priorities',
    stage: 'org_framing',
    prompt: 'What are your top 3 priorities for the next 30 days?',
    helpText: 'Concrete goals with measurable outcomes. Your AI agents will use these to prioritize their work.',
    defaultAnswer: 'Ship v1 of our product, onboard first 10 users, establish CI/CD pipeline.',
    artifactType: 'priorities',
  },
  {
    id: 'org_voice',
    stage: 'org_framing',
    prompt: 'How does your organization communicate? What\'s your tone?',
    helpText: 'Formal or casual? Technical or accessible? Give examples of good communication from your org. Agents use this for all external content.',
    defaultAnswer: 'Professional but approachable. Technical accuracy matters. No jargon in user-facing content.',
    artifactType: 'brand_voice',
  },
  {
    id: 'org_departments',
    stage: 'org_framing',
    prompt: 'What departments should your AI org have?',
    helpText: 'Common templates: Development, Marketing, Operations, Support, Executive, Finance. You can customize, add, or remove any.',
    defaultAnswer: 'Development, Marketing, Operations, Support, Executive',
    followUp: 'Would you like to customize any department descriptions or add specialized ones?',
    artifactType: 'departments',
  },
  {
    id: 'org_tools',
    stage: 'org_framing',
    prompt: 'What tools and services does your organization use?',
    helpText: 'GitHub repos, Slack/Discord, project management tools, cloud services, etc. Agents can integrate with these.',
    defaultAnswer: 'GitHub for code, Discord for communication.',
    artifactType: 'tools',
  },

  // ─── Stage 2: Ingestion ────────────────────────────────────────────────
  {
    id: 'ingestion_prompt',
    stage: 'ingestion',
    prompt: 'Do you have any documents, repos, or URLs you\'d like to import?',
    helpText: 'You can upload files (PDF, DOCX, TXT, MD, CSV, JSON, YAML), paste URLs, or link GitHub repos. These give your agents organizational context. You can skip this step.',
    defaultAnswer: 'Skip for now.',
  },

  // ─── Stage 3: Departments ──────────────────────────────────────────────
  {
    id: 'department_review',
    stage: 'departments',
    prompt: 'Review your department configuration. Would you like to make any changes?',
    helpText: 'Each department has been configured with agents, charters, and recurring tasks based on your answers. You can adjust any settings.',
    defaultAnswer: 'Looks good, proceed.',
  },

  // ─── Stage 4: Operators ────────────────────────────────────────────────
  {
    id: 'operator_invite',
    stage: 'operators',
    prompt: 'Would you like to invite additional operators?',
    helpText: 'The root operator (you) is already set up. You can invite team members with specific roles, departments, and rate limits.',
    defaultAnswer: 'No additional operators for now.',
  },
] as const;

/** Get questions for a specific stage. */
export function getQuestionsForStage(stage: string): QuestionDefinition[] {
  return ONBOARDING_QUESTIONS.filter(q => q.stage === stage);
}

/** Get a question by ID. */
export function getQuestionById(id: string): QuestionDefinition | undefined {
  return ONBOARDING_QUESTIONS.find(q => q.id === id);
}
