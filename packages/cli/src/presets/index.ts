import type { WizardState, PresetName } from '../types.js';
import { localDemoPreset } from './local-demo.js';
import { smallTeamPreset } from './small-team.js';
import { awsProductionPreset } from './aws-production.js';

const PRESETS: Record<PresetName, WizardState> = {
  'local-demo': localDemoPreset,
  'small-team': smallTeamPreset,
  'aws-production': awsProductionPreset,
};

export function getPreset(name: PresetName): WizardState {
  // Return a deep clone to prevent mutation of the canonical preset
  return structuredClone(PRESETS[name]);
}

export function isValidPreset(name: string): name is PresetName {
  return name in PRESETS;
}

export function listPresets(): PresetName[] {
  return Object.keys(PRESETS) as PresetName[];
}
