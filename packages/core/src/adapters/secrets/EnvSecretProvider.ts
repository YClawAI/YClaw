/**
 * EnvSecretProvider — Environment variable adapter for ISecretProvider.
 *
 * Reads secrets from process.env. This is the default for local development
 * and Docker Compose deployments where secrets are passed as env vars.
 */

import type { ISecretProvider } from '../../interfaces/ISecretProvider.js';

export class EnvSecretProvider implements ISecretProvider {
  async get(key: string): Promise<string | null> {
    return process.env[key] ?? null;
  }

  async getRequired(key: string): Promise<string> {
    const value = process.env[key];
    if (value === undefined || value === '') {
      throw new Error(`Required secret "${key}" is not set in environment`);
    }
    return value;
  }

  async list(): Promise<string[]> {
    return Object.keys(process.env);
  }

  async has(key: string): Promise<boolean> {
    return key in process.env && process.env[key] !== undefined;
  }
}
