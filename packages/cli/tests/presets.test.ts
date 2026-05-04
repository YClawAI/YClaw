import { describe, it, expect } from 'vitest';
import { getPreset, isValidPreset, listPresets } from '../src/presets/index.js';
import { resolveInitPlan } from '../src/plan/resolve.js';
import { CliConfigSchema } from '../src/schema/cli-config-schema.js';
import { YclawConfigSchema } from '@yclaw/core/infrastructure';

describe('Presets', () => {
  it('lists all 3 presets', () => {
    expect(listPresets()).toEqual(['local-demo', 'small-team', 'aws-production']);
  });

  it('validates preset names', () => {
    expect(isValidPreset('local-demo')).toBe(true);
    expect(isValidPreset('small-team')).toBe(true);
    expect(isValidPreset('aws-production')).toBe(true);
    expect(isValidPreset('nonexistent')).toBe(false);
  });

  it('local-demo preset has correct defaults', () => {
    const preset = getPreset('local-demo');
    expect(preset.deployment.target).toBe('docker-compose');
    expect(preset.channels.slack).toBe(false);
    expect(preset.llm.provider).toBe('anthropic');
  });

  it('small-team preset enables Slack', () => {
    const preset = getPreset('small-team');
    expect(preset.channels.slack).toBe(true);
    expect(preset.deployment.target).toBe('docker-compose');
  });

  it('aws-production preset uses terraform deployment + S3', () => {
    const preset = getPreset('aws-production');
    expect(preset.deployment.target).toBe('terraform');
    expect(preset.storage.objects).toBe('s3');
    expect(preset.channels.discord).toBe(true);
  });
});

describe('resolveInitPlan', () => {
  for (const name of listPresets()) {
    describe(`preset: ${name}`, () => {
      const preset = getPreset(name);
      const plan = resolveInitPlan(preset);

      it('produces a valid CliConfig', () => {
        expect(() => CliConfigSchema.parse(plan.config)).not.toThrow();
      });

      it('core subset validates against strict core schema', () => {
        const coreSubset = {
          storage: plan.config.storage,
          secrets: plan.config.secrets,
          channels: plan.config.channels,
        };
        expect(() => YclawConfigSchema.parse(coreSubset)).not.toThrow();
      });

      it('env has NODE_ENV and PORT', () => {
        expect(plan.env.NODE_ENV).toBe('production');
        expect(plan.env.PORT).toBeDefined();
      });

      it('env has EVENT_BUS_SECRET (64 hex chars)', () => {
        expect(plan.env.EVENT_BUS_SECRET).toMatch(/^[0-9a-f]{64}$/);
      });

      it('summary is non-empty', () => {
        expect(plan.summary.length).toBeGreaterThan(0);
      });

      it('requirements has correct dockerRequired flag', () => {
        expect(plan.requirements.dockerRequired).toBe(
          preset.deployment.target === 'docker-compose',
        );
      });

      it('requirements lists LLM API key', () => {
        expect(plan.requirements.credentialsRequired).toContain(
          'ANTHROPIC_API_KEY',
        );
      });
    });
  }

  it('docker-compose presets include compose spec', () => {
    const plan = resolveInitPlan(getPreset('local-demo'));
    expect(plan.compose).not.toBeNull();
    expect(plan.compose?.services.yclaw).toBeDefined();
    expect(plan.compose?.services['mission-control']).toBeDefined();
    expect(plan.compose?.services.ao).toBeDefined();
    expect(plan.compose?.services.mongodb).toBeDefined();
    expect(plan.compose?.services.redis).toBeDefined();
    expect(plan.compose?.services.postgres).toBeDefined();
  });

  it('manual deployment presets have null compose', () => {
    const plan = resolveInitPlan(getPreset('aws-production'));
    expect(plan.compose).toBeNull();
  });

  it('small-team env includes SLACK_BOT_TOKEN', () => {
    const plan = resolveInitPlan(getPreset('small-team'));
    expect('SLACK_BOT_TOKEN' in plan.env).toBe(true);
  });

  it('aws-production requirements include Discord token', () => {
    const plan = resolveInitPlan(getPreset('aws-production'));
    expect(plan.requirements.credentialsRequired).toContain('DISCORD_BOT_TOKEN');
  });
});
