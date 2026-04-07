# Finance Department

The Finance department tracks treasury balances, infrastructure costs, and AI service spending across the organization. It contains a single agent -- Treasurer -- that monitors financial data sources including wallets, bank accounts, and cloud service costs.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **Treasurer** | claude-sonnet-4-6 | Financial watchdog. Runs daily treasury checks, weekly spend tracking, and monthly financial summaries. Alerts on low balances and anomalous spending patterns. Operates at temperature 0 for deterministic financial reporting. |

## Data Flow

```mermaid
flowchart LR
    subgraph "Data Sources"
        WALLETS[Wallet RPCs<br/>Blockchain wallets]
        BANK[Banking APIs<br/>Bank accounts]
        AI[AI Usage<br/>LLM provider spend]
        INFRA[Infrastructure<br/>Cloud service costs]
    end

    subgraph Finance
        TREASURER[Treasurer]
    end

    WALLETS --> TREASURER
    BANK --> TREASURER
    AI --> TREASURER
    INFRA --> TREASURER

    TREASURER -- treasurer:low_balance --> SLACK[Slack Alerts]
    TREASURER -- treasurer:spend_report --> STRATEGIST[Strategist<br/>Executive]
    TREASURER -- standup:report --> STRATEGIST
```

## Event Subscriptions and Publications

### Treasurer

| Direction | Event |
|-----------|-------|
| Subscribes | `treasurer:directive`, `claudeception:reflect` |
| Publishes | `standup:report`, `treasurer:low_balance`, `treasurer:spend_report` |

## Scheduled Tasks (Crons)

| Schedule (UTC) | Task | Description |
|----------------|------|-------------|
| 13:22 daily | `daily_standup` | Daily standup report |
| 07:00 daily | `treasury_check` | Check all wallet balances and flag anomalies |
| 08:00 Monday | `weekly_spend` | Weekly spending breakdown |
| 08:00 1st of month | `monthly_summary` | Monthly financial summary |

## Data Sources

Treasurer supports multiple data source types. Configure your specific wallets, accounts, and services in `departments/finance/treasurer.yaml` under the `data_sources` section.

### Supported Source Types

| Source Type | Description | Example Providers |
|-------------|-------------|-------------------|
| `blockchain_rpc` | On-chain wallet balance monitoring | Helius, Alchemy, Infura, QuickNode |
| `banking_api` | Bank account balance and transaction data | Teller.io, Plaid, Mercury |
| `ai_usage` | LLM provider spend tracking | LiteLLM, OpenRouter, direct provider APIs |
| `infra_cost` | Cloud infrastructure cost monitoring | AWS Cost Explorer, GCP Billing, Azure Cost Management |

Each data source is defined with a `name`, `type`, and `config` block in the agent YAML. See the [Configuration Schema](../README.md#configuration-schema) for the full format.

## Key Capabilities

### Multi-Source Treasury Monitoring

Treasurer monitors wallet balances across configured blockchain RPCs. Add wallet data sources in `treasurer.yaml` to track native balances and token accounts on any supported chain.

### Banking Integration

Banking integrations provide read-only access to connected accounts. SSRF protection rejects full URLs in endpoint config to prevent credential leakage. Configure your banking provider in the `data_sources` section.

### Infrastructure Cost Tracking

Infrastructure cost fetchers track spending across cloud providers. Configure your active cloud services in `treasurer.yaml` to enable cost monitoring and alerting.

### Alert Thresholds

Treasurer publishes `treasurer:low_balance` alerts when balances drop below configured thresholds. Adjust thresholds in `treasurer.yaml` to match your actual balances.

## Skills

The Treasurer has 4 specialized skills:

1. `treasury-operations` -- Operational procedures (on-demand)
2. `treasury-protocol-reference` -- Trimmed protocol overview (on-demand)
3. `ai-usage-tracking` -- AI spend monitoring guide
4. `infra-cost-tracking` -- Infrastructure cost monitoring guide

## Actions Available

| Action | Treasurer |
|--------|:---------:|
| `github:commit_file` | x |
| `github:get_contents` | x |
| `github:create_branch` | x |
| `slack:message` | x |
| `slack:thread_reply` | x |
| `slack:alert` | x |
| `event:publish` | x |

## Customization

Configure your wallets and financial data sources in `departments/finance/treasurer.yaml`. Each data source needs a `name`, `type`, and provider-specific `config` block. Alert thresholds for low balance warnings can also be configured per data source.

## Configuration Files

- [`treasurer.yaml`](treasurer.yaml) -- Treasurer agent config
