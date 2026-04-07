# Treasury Operations

> Loaded by the Treasurer agent. Defines data sources, wallet addresses, and
> operational procedures for treasury monitoring.

---

## Data Access

### Solana — Helius RPC (Primary)
- **Endpoint:** `https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>`
- **Env var:** `HELIUS_API_KEY` (set in production secrets)
- **Enhanced APIs:** DAS (Digital Asset Standard), parsed transactions, priority fees, webhooks
- **Docs:** https://docs.helius.dev

Use the `solana_rpc` data source type to query balances, token accounts, and transaction history.

### Ethereum / Multichain — Alchemy
- **Env var:** `ALCHEMY_API_KEY` (set in production secrets)
- **Chains:** Ethereum, Polygon, Arbitrum, Optimism, Base, etc.
- **Docs:** https://docs.alchemy.com

### Key Solana RPC Methods

**Check SOL balance:**
```json
{ "method": "getBalance", "params": ["<wallet_address>"] }
```

**Check USDC/SPL token balance:**
```json
{ "method": "getTokenAccountsByOwner", "params": ["<wallet_address>", { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }] }
```

**Recent transactions:**
```json
{ "method": "getSignaturesForAddress", "params": ["<wallet_address>", { "limit": 20 }] }
```

### Helius Enhanced APIs

**Parsed transaction history (human-readable):**
```
GET https://api.helius.xyz/v0/addresses/<wallet>/transactions?api-key=${HELIUS_API_KEY}
```

**Token balances (all SPL tokens at once):**
```
POST https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>
{ "jsonrpc": "2.0", "id": 1, "method": "getAssetsByOwner", "params": { "ownerAddress": "<wallet>" } }
```

---

## Monitoring Schedule

| Task | Frequency | What to Check |
|------|-----------|---------------|
| `treasury_check` | Daily 7am UTC | SOL + USDC balances across all treasury wallets, flag anomalies |
| `weekly_spend` | Monday 8am UTC | Net inflows/outflows, LLM API costs (Anthropic + OpenRouter), infra costs |
| `monthly_summary` | 1st of month 8am UTC | Full treasury report: balances, burn rate, runway estimate |

## Alert Thresholds

- **SOL balance < 5 SOL** on any treasury wallet → immediate Slack alert
- **USDC balance drops > 20% in 24h** → immediate Slack alert
- **Unknown outbound transaction > $1,000** → immediate Slack alert + escalate to team lead
- **Monthly burn rate exceeds budget** → flag in weekly report

## Reporting Format

Use this template for treasury reports:

```
💰 Treasury Report — [DATE]

SOL Balances:
• Treasury: [amount] SOL ($[usd])
• Fee Payer: [amount] SOL ($[usd])

USDC Balances:
• Treasury: [amount] USDC

Burn Rate:
• LLM API (est): $[amount]/month
• Infrastructure: $[amount]/month
• Total: $[amount]/month

Runway: [months] at current burn
```

## Banking

Treasurer has read-only access to YClaw's bank accounts via the Teller.io API:
- **Checking account** — operational funds, payroll, vendor payments
- **Credit card** — business expenses

Data sources:
- `bank_accounts` — lists all connected accounts (type, name, status, last four digits)
- `bank_balances` — fetches available + ledger balances for all accounts

### Banking Report Template

```
🏦 Banking Summary — [DATE]

Checking Account (****[last4]):
• Available: $[amount]
• Ledger: $[amount]

Credit Card (****[last4]):
• Available Credit: $[amount]
• Current Balance: $[amount]
```

### Alert Thresholds
- **Checking balance < $10,000** → immediate Slack alert
- **Credit card utilization > 80%** → flag in weekly report

## What You Cannot Do

- Never move funds or sign transactions
- Never share wallet private keys or seed phrases
- Never make investment recommendations
- Never predict token prices
- Report numbers factually — no editorializing
