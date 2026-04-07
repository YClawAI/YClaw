# Troubleshooting Guide

Common issues and diagnostic steps for escalated support cases.

## Chrome Extension Issues

### Extension Won't Install
1. Verify Chrome or Chromium-based browser (Edge, Brave, Arc)
2. Check Chrome version is current (Settings → About Chrome)
3. Clear browser cache and cookies
4. Disable conflicting extensions (ad blockers, privacy tools)
5. Try incognito mode to isolate extension conflicts
6. If persistent → escalate to Builder with browser version + OS

### Watch Time Not Recording
1. Confirm creator is on YClaw (has launched token)
2. Check extension is enabled (green icon)
3. Verify stream/video is actually playing (not paused/buffering)
4. Check if ad blocker is interfering with content scripts
5. Try refreshing the page
6. If persistent → collect: platform, creator, browser version, extension version → escalate

### Extension Shows "Not Connected"
1. Click extension icon → Connect Wallet
2. Ensure wallet extension is installed and unlocked
3. Try disconnecting and reconnecting wallet
4. Clear extension storage (right-click → Manage Extension → Clear Data)
5. Reinstall extension as last resort

## Transaction Issues

### Transaction Failed
Common causes:
- **Insufficient SOL:** Need ~0.00025 SOL per tx. Check balance.
- **Network congestion:** Wait 30-60 seconds, retry.
- **Slippage too low:** Increase slippage tolerance for volatile tokens.
- **Stale price data:** Refresh page to get current bonding curve price.

### Claim Not Working
1. Verify period has actually closed (check leaderboard)
2. For stakers: must call `accrue_position_rewards` before `claim_staker_rewards`
3. Check sufficient SOL for gas
4. If "already claimed" error → check wallet transaction history
5. If persistent → collect wallet address + creator token → escalate to Builder

### Staking/Unstaking Errors
1. Check lock period hasn't expired/isn't still active
2. Verify token balance in wallet
3. Ensure approval transaction completed
4. If lock-related confusion → explain lock mechanics from FAQ
5. If contract error → escalate with full error message

## Wallet Issues

### Wallet Won't Connect
1. Supported wallets: Phantom, Magic Eden, Backpack (any Solana-compatible)
2. Ensure wallet is on Solana mainnet (not devnet/testnet)
3. Try different wallet if available
4. Check for browser popup blockers

### Wrong Network
- YClaw is Solana mainnet only
- If user is on devnet/testnet → switch in wallet settings
- If user has EVM wallet (MetaMask) → need a Solana wallet instead

## Account Issues

### Multiple Accounts / Wallet Confusion
- Positions are tied to wallet address, not email/username
- If user has multiple wallets, options/stakes are separate per wallet
- No way to merge positions across wallets (on-chain limitation)

## When to Escalate to Builder
- Reproducible bugs with clear steps
- Error messages that reference smart contract failures
- Issues affecting multiple users simultaneously
- Any issue involving loss or inaccessibility of funds

**Always include when escalating:**
- User's wallet address (if shared)
- Browser + OS + extension version
- Steps to reproduce
- Error messages (exact text or screenshot)
- Affected platform (YouTube, Twitch, etc.)
