import { redirect } from 'next/navigation';

interface Props {
  params: { path?: string[] };
}

export default function VaultRedirect({ params }: Props) {
  const segments = params.path ?? [];
  const target = segments.length > 0 ? `/system/vault/${segments.join('/')}` : '/system/vault';
  redirect(target);
}
