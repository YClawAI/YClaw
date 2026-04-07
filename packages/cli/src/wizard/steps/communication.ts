import { select, confirm } from '@inquirer/prompts';
import type { WizardState } from '../../types.js';

const STYLE_CHOICES = [
  {
    name: 'Detailed  — Full sentences with context and reasoning',
    value: 'detailed' as const,
  },
  {
    name: 'Balanced  — Clear and concise, no fluff (recommended)',
    value: 'balanced' as const,
  },
  {
    name: 'Concise   — Brief fragments, maximum efficiency',
    value: 'concise' as const,
  },
];

const DEPARTMENT_DEFAULTS: Record<string, 'detailed' | 'balanced' | 'concise'> = {
  executive: 'detailed',
  marketing: 'detailed',
  development: 'concise',
  operations: 'balanced',
  finance: 'balanced',
  support: 'detailed',
};

export async function communicationStep(
  state: WizardState,
): Promise<WizardState> {
  const defaultStyle = await select({
    message: 'How should your AI team communicate internally?\n  (Affects status updates, handoffs, discussions — not deliverables)',
    choices: STYLE_CHOICES,
    default: 'balanced',
  });

  const customize = await confirm({
    message: 'Customize by department?',
    default: false,
  });

  let departmentOverrides: Record<string, 'detailed' | 'balanced' | 'concise'> = {};

  if (customize) {
    const departments = ['executive', 'marketing', 'development', 'operations', 'finance', 'support'];
    for (const dept of departments) {
      const suggested = DEPARTMENT_DEFAULTS[dept] ?? defaultStyle;
      const style = await select({
        message: `  ${dept}:`,
        choices: STYLE_CHOICES,
        default: suggested,
      });
      if (style !== defaultStyle) {
        departmentOverrides[dept] = style;
      }
    }
  }

  return {
    ...state,
    communication: {
      style: defaultStyle,
      departmentOverrides,
    },
  };
}
