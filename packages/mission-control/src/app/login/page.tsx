'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

function getErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  switch (errorCode) {
    case 'CredentialsSignin':
      return 'Invalid API key.';
    case 'Configuration':
      return 'System configuration error — contact admin.';
    case 'SessionRequired':
      return 'Session expired — please log in again.';
    default:
      return 'Authentication error — try again.';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(
    getErrorMessage(searchParams.get('error'))
  );
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || cooldown) return;

    setErrorMessage(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const apiKey = formData.get('key') as string;

    try {
      const result = await signIn('credentials', {
        apiKey,
        redirect: false,
      });

      if (result?.ok) {
        // Clear legacy mc_api_key cookie (best-effort — HttpOnly cookies
        // can't be cleared client-side, but this handles non-HttpOnly ones)
        document.cookie = 'mc_api_key=; path=/; max-age=0';
        router.push('/');
        router.refresh();
        return;
      }

      setErrorMessage(getErrorMessage(result?.error ?? 'CredentialsSignin') ?? 'Invalid API key.');
      // Basic brute-force protection: 2s cooldown after failure
      setCooldown(true);
      setTimeout(() => setCooldown(false), 2000);
    } catch {
      setErrorMessage('Authentication error — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mc-bg flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="border border-mc-border rounded-lg p-8 bg-mc-surface-hover">
          <div className="mb-8 text-center">
            <h1 className="font-mono text-lg font-bold text-mc-accent tracking-widest">
              MISSION CONTROL
            </h1>
            <p className="text-mc-text-tertiary text-xs mt-1">YClaw Agent Fleet Dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs text-mc-text-tertiary mb-1 font-mono">
                Operator API Key
              </label>
              <input
                type="password"
                name="key"
                required
                placeholder="gzop_live_..."
                disabled={loading}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono text-mc-text placeholder-mc-border focus:outline-none focus:border-mc-accent transition-colors disabled:opacity-50"
              />
            </div>

            {errorMessage && (
              <p className="text-xs text-mc-danger font-mono">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || cooldown}
              className="w-full py-2 px-4 bg-mc-accent/20 border border-mc-accent/40 text-mc-accent rounded text-sm font-mono hover:bg-mc-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Authenticating...' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
