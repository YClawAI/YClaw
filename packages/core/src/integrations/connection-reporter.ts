/**
 * ConnectionReporter — fleet agent → Mission Control status callback.
 *
 * After a fleet agent (Builder, Deployer) completes a wiring step, it uses
 * this reporter to update the ConnectionSession in Mission Control.
 */

export interface StepUpdate {
  status: 'active' | 'complete' | 'failed' | 'skipped';
  detail?: string;
}

export class ConnectionReporter {
  private readonly mcUrl: string;
  private readonly apiKey: string | undefined;

  constructor(mcUrl?: string, apiKey?: string) {
    this.mcUrl = mcUrl ?? process.env.MISSION_CONTROL_URL ?? 'http://localhost:3001';
    this.apiKey = apiKey ?? process.env.MC_API_KEY;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      h['x-api-key'] = this.apiKey;
    }
    return h;
  }

  /**
   * Update a single step within a ConnectionSession.
   * Calls PATCH /api/connections/[sessionId] with step-level update.
   */
  async updateStep(sessionId: string, stepId: string, update: StepUpdate): Promise<void> {
    const res = await fetch(`${this.mcUrl}/api/connections/${sessionId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({
        steps: [{ id: stepId, status: update.status, detail: update.detail }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ConnectionReporter: PATCH failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }

  /**
   * Update the session-level status (e.g., mark as 'connected' or 'failed').
   */
  async updateStatus(
    sessionId: string,
    status: 'wiring' | 'verifying' | 'connected' | 'failed',
    error?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = { status };
    if (error) body.error = error;

    const res = await fetch(`${this.mcUrl}/api/connections/${sessionId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ConnectionReporter: status update failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  /**
   * Convenience: mark a step complete and optionally advance session status.
   */
  async completeStep(
    sessionId: string,
    stepId: string,
    detail?: string,
    sessionStatus?: 'wiring' | 'verifying' | 'connected',
  ): Promise<void> {
    const body: Record<string, unknown> = {
      steps: [{ id: stepId, status: 'complete', detail }],
    };
    if (sessionStatus) body.status = sessionStatus;

    const res = await fetch(`${this.mcUrl}/api/connections/${sessionId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ConnectionReporter: completeStep failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}
