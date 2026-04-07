import type { TreasuryData } from './treasury-data';

export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  metric?: string;
  action?: { label: string; drawer: string; drawerProps?: Record<string, unknown> };
}

function severityOrder(s: AttentionItem['severity']): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}

export function getAttentionItems(data: TreasuryData): AttentionItem[] {
  const items: AttentionItem[] = [];

  // ── Runway alert ──
  if (data.runway.daysRemaining < 180) {
    items.push({
      id: 'runway-critical',
      severity: 'critical',
      title: 'Low Runway',
      description: `${data.runway.daysRemaining} days at current burn rate`,
      metric: `$${data.runway.monthlyBurn.toFixed(0)}/mo burn`,
    });
  } else if (data.runway.daysRemaining < 365) {
    items.push({
      id: 'runway-warning',
      severity: 'warning',
      title: 'Runway Under 1 Year',
      description: `${data.runway.daysRemaining} days remaining`,
      metric: `$${data.runway.monthlyBurn.toFixed(0)}/mo burn`,
    });
  }

  // ── Budget alerts: agents over their configured alert threshold ──
  if (data.budget.config.mode !== 'off') {
    for (const agent of data.budget.agents) {
      if (!agent.hasBudget) continue; // skip agents with no saved budget
      const threshold = agent.alertThresholdPercent;
      const pct = agent.dailyLimitCents > 0
        ? (agent.dailySpendCents / agent.dailyLimitCents) * 100
        : 0;
      if (pct >= 100) {
        items.push({
          id: `budget-over-${agent.agentId}`,
          severity: 'critical',
          title: `${agent.label} Over Budget`,
          description: `${pct.toFixed(0)}% of daily limit`,
          metric: `$${(agent.dailySpendCents / 100).toFixed(2)}/$${(agent.dailyLimitCents / 100).toFixed(2)}`,
          action: { label: 'Fix', drawer: 'agent-budget', drawerProps: { agentId: agent.agentId } },
        });
      } else if (pct >= threshold) {
        items.push({
          id: `budget-warn-${agent.agentId}`,
          severity: 'warning',
          title: `${agent.label} at ${pct.toFixed(0)}% Budget`,
          description: `Approaching daily limit (alert at ${threshold}%)`,
          metric: `$${(agent.dailySpendCents / 100).toFixed(2)}/$${(agent.dailyLimitCents / 100).toFixed(2)}`,
          action: { label: 'Fix', drawer: 'agent-budget', drawerProps: { agentId: agent.agentId } },
        });
      }
    }

    // Fleet budget check
    const fleetDailyPct = data.budget.config.globalDailyLimitCents > 0
      ? (data.budget.fleetDailySpendCents / data.budget.config.globalDailyLimitCents) * 100
      : 0;
    if (fleetDailyPct >= 100) {
      items.push({
        id: 'fleet-budget-over',
        severity: 'critical',
        title: 'Fleet Over Daily Budget',
        description: `${fleetDailyPct.toFixed(0)}% of fleet daily limit`,
        metric: `$${(data.budget.fleetDailySpendCents / 100).toFixed(2)}/$${(data.budget.config.globalDailyLimitCents / 100).toFixed(2)}`,
        action: { label: 'Fix', drawer: 'budget-settings' },
      });
    } else if (fleetDailyPct >= 80) {
      items.push({
        id: 'fleet-budget-warn',
        severity: 'warning',
        title: 'Fleet at ' + fleetDailyPct.toFixed(0) + '% Budget',
        description: 'Approaching fleet daily limit',
        action: { label: 'Fix', drawer: 'budget-settings' },
      });
    }
  }

  // ── Spend spike: today > 2x 7-day average ──
  if (data.llmSpend.dailyTrend.length >= 7) {
    const recent7 = data.llmSpend.dailyTrend.slice(-7);
    const avg7 = recent7.reduce((s, d) => s + d.spendCents, 0) / 7;
    if (avg7 > 0 && data.llmSpend.todaySpendCents > avg7 * 2) {
      items.push({
        id: 'spend-spike',
        severity: 'warning',
        title: 'Spend Spike Today',
        description: `${((data.llmSpend.todaySpendCents / avg7) * 100 - 100).toFixed(0)}% above 7-day average`,
        metric: `$${(data.llmSpend.todaySpendCents / 100).toFixed(2)} vs avg $${(avg7 / 100).toFixed(2)}`,
      });
    }
  }

  // ── Banking low: any account < $5,000 ──
  if (data.banking) {
    for (const account of data.banking.accounts) {
      if (account.type !== 'credit_card' && account.availableBalance < 5000) {
        items.push({
          id: `banking-low-${account.id}`,
          severity: 'warning',
          title: `Low Balance: ${account.name}`,
          description: `$${account.availableBalance.toFixed(2)} available`,
          metric: account.institution,
        });
      }
    }
  }

  // ── Stale data: any snapshot > 24h old ──
  const now = Date.now();
  for (const [source, ts] of Object.entries(data.lastUpdated)) {
    if (source === 'llm') continue;
    const age = now - new Date(ts).getTime();
    if (age > 24 * 3600000) {
      const hoursAgo = Math.round(age / 3600000);
      items.push({
        id: `stale-${source}`,
        severity: 'info',
        title: `Stale Data: ${source}`,
        description: `Last updated ${hoursAgo}h ago`,
      });
    }
  }

  return items.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));
}
