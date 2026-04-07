'use client';

import { useState, type ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SSEProvider } from '@/lib/hooks/sse-provider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider basePath="/auth">
      <QueryClientProvider client={queryClient}>
        <SSEProvider>{children}</SSEProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
