import { redirect } from 'next/navigation';
import { getAgent } from '@/lib/agents';

interface Props {
  params: { name: string };
}

export default function AgentDetailRedirect({ params }: Props) {
  const agent = getAgent(params.name);
  if (agent) {
    redirect(`/departments/${agent.department}?agent=${params.name}`);
  }
  redirect('/');
}
