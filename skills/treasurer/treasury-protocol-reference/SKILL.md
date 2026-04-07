# Treasury Protocol Reference

> Quick reference for Treasurer. For full protocol details, see protocol-overview.md.

## YClaw On-Chain Programs

| Program | Address |
|---|---|
| Tokens | `XEENqbVXt8y94cH7WMwYyQSuDgkvzZTzEzpsWLZu7Jf` |
| Voter | `XNGVXFcvqTM7ET3kwztFskFBmygQFXQVRQVBKp5Frvm` |
| Lend | `LENDcjsxpmVPrAG9nYp6hbQDVcsFjsaaPcRQow5W8te` |
| Payments | `BkWxgtCSpwBwrL7aBmAtM5i76ZmZLS3otc3D4ShLbJV9` |
| Mayflower | `MMkP6WPG4ySTudigPQpKNpranEYBzYRDe8Ua7Dx89Rk` |

## Key Metrics to Track

| Metric | Definition | Source |
|---|---|---|
| TVL | Total value of all staked creator tokens | On-chain staking accounts |
| Active Wallets | Unique wallets interacting with YClaw programs/day | On-chain |
| Creator Tokens | Total bonding curves deployed | On-chain curve accounts |
| 24h Volume | Buy + sell transaction value in 24h | On-chain tx logs |

## API Endpoints (when live)

```
GET /tokens/platform          → TVL, volume, global stats
GET /tokens/platform/activity → Global activity feed
```

**Note:** `api.yclaw.ai` is NOT live yet. These endpoints are for future use.

## Metric Reporting Rules

1. Always include timestamp or "as of" qualifier
2. Round appropriately: "$1.2M TVL" not "$1,203,847.23"
3. Never editorialize: "TVL reached $500K" not "TVL reached an incredible $500K"
4. Never imply metric growth means financial returns
