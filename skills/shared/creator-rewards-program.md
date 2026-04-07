# Creator Rewards Program — Technical Reference

> **Terminology note:** "Creator Rewards Program" is the official program name. On-chain account
> types (XeenonMarketGroup, XeenonMarket, XeenonPosition, XeenonMarketPeriod), instruction names
> (init_xeenon_position), and source file paths (xeenon_market.rs, xeenon-solana-programs) retain
> the legacy "Xeenon" naming — these are immutable on-chain identifiers from before the YClaw
> rebrand. In agent-facing communication, always use "YClaw" for the protocol and "options" for
> what stakers earn. "Rewards" is acceptable only when referring to the Creator Rewards Program
> by name or to on-chain field names (earned_rewards, claimed_rewards, etc.).

This document describes the Creator Rewards Program, the mechanism that connects watching to on-chain options. This is the core loop of the YClaw protocol: watchers drive leaderboard scores, leaderboard position determines how much of each creator market's accrued options get minted each period, and minted tokens are split between creators and stakers.

---

## How It All Connects

The Creator Rewards Program is NOT a separate system from staking/options. It IS the system. Here is how watching, staking, and rewards tie together:

```
WATCHING (off-chain)          STAKING (on-chain)             REWARDS (on-chain)
─────────────────────         ──────────────────             ─────────────────
Chrome extension              User stakes creator            Options accrue
tracks watch time    ──┐      tokens into market    ──┐     per-second per-token
across 9 platforms     │                               │     in exercisable_options
                       │                               │
                       v                               v
              ┌─────────────────────────────────────────────┐
              │         MONTHLY PERIOD CLOSE                 │
              │                                             │
              │  Leaderboard position  ──>  Mint percentage │
              │  (1st=100%, 25th=4%)       of accrued       │
              │                            options          │
              │                                             │
              │  Options minted via Mayflower CPI            │
              │  Options exercised into real creator tokens  │
              │  Tokens held by the program (market PDA)     │
              │                                             │
              │  Split: creator share % + staker remainder   │
              └─────────────────────────────────────────────┘
                       │                               │
                       v                               v
              Creator claims                   Stakers claim
              their share                      their share
```

**Key insight:** Without watchers, a creator's leaderboard position drops, and a smaller percentage of their market's options get minted. Watching and staking are symbiotic — staking accrues options, watching determines how much of those options get realized.

---

## State Diagram: Market Period Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                      PERIOD N ACTIVE                              │
│                                                                  │
│  On-chain (continuous):                                          │
│  ├─ Options accruing per-second per-staked-token                 │
│  ├─ exercisable_options growing (includes rollover from prior)   │
│  ├─ creator_accrued_reward_shares growing                        │
│  ├─ stakers_accrued_reward_shares growing                        │
│  ├─ stakers_index increasing                                     │
│  └─ Any deposit/withdraw/buy/sell triggers update_index()        │
│                                                                  │
│  Off-chain (continuous):                                         │
│  ├─ Chrome extension tracking viewer sessions                    │
│  ├─ Leaderboard scores accumulating                              │
│  ├─ Score = watch_time × viewer_multiplier                       │
│  └─ Creator rankings updating in real-time                       │
│                                                                  │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       │ Admin calls close_market_period
                       │ with mint_percentage (4-100%)
                       │ based on creator's leaderboard position
                       │
                       v
┌──────────────────────────────────────────────────────────────────┐
│                      PERIOD CLOSE (atomic)                        │
│                                                                  │
│  1. Final update_index() — settle all pending accruals           │
│  2. mint_amount = exercisable_options × mint_pct / 100           │
│  3. exercisable_options -= mint_amount (remainder rolls over)    │
│  4. CPI: mint_options(mint_amount) → options in market ATA       │
│  5. CPI: exercise_options(mint_amount) → real tokens in ATA      │
│  6. distribute_rewards():                                        │
│     ├─ creator_tokens = based on creator_accrued_shares ratio    │
│     └─ staker_tokens = remainder                                 │
│  7. Create XeenonMarketPeriod snapshot                           │
│  8. Reset: stakers_index=0, both accrued_shares=0                │
│  9. current_period += 1                                          │
│  10. Emit MarketPeriodClosedEvent                                │
│                                                                  │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       v
┌──────────────────────────────────────────────────────────────────┐
│                      PERIOD N+1 ACTIVE                            │
│                                                                  │
│  Options that were NOT minted (100% - mint_pct) remain in        │
│  exercisable_options and roll forward. Accrual continues.        │
│                                                                  │
│  Meanwhile, stakers can now accrue and claim Period N rewards:   │
│  ├─ accrue_position_rewards → converts shares to earned_rewards  │
│  └─ claim_staker_rewards → transfers tokens to wallet            │
│  And creators can claim:                                         │
│  └─ claim_creator_rewards → transfers tokens to wallet           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## State Diagram: Staker Position Lifecycle

```
┌────────────────────┐
│  POSITION CREATED  │  init_xeenon_position
│  deposited = 0     │
│  last_seen = N     │
└────────┬───────────┘
         │
         │ deposit_token (stake)
         v
┌────────────────────────────────────────────────────┐
│  SYNCED (last_seen_period == market.current_period) │
│                                                    │
│  ├─ deposit_token → increase stake, sync index     │
│  ├─ withdraw_token → decrease stake, sync index    │
│  └─ staged_rewards_shares accumulating via delta    │
│                                                    │
└────────────────────┬───────────────────────────────┘
                     │
                     │ Period N closes → market.current_period = N+1
                     v
┌────────────────────────────────────────────────────┐
│  BEHIND PERIOD (last_seen < current_period)         │
│                                                    │
│  Position has staged_rewards_shares from Period N   │
│  but hasn't converted them to earned_rewards yet    │
│                                                    │
│  Must call accrue_position_rewards before:          │
│  ├─ deposit_token                                  │
│  ├─ withdraw_token                                 │
│  └─ claim_staker_rewards                           │
│                                                    │
└────────────────────┬───────────────────────────────┘
                     │
                     │ accrue_position_rewards
                     v
┌────────────────────────────────────────────────────┐
│  REWARDS EARNED                                     │
│                                                    │
│  earned = staged_shares / period.total_shares       │
│           × period.total_stakers_rewards            │
│                                                    │
│  earned_rewards += earned                           │
│  staged_rewards_shares = 0                          │
│  last_seen_period += 1                              │
│                                                    │
└────────────────────┬───────────────────────────────┘
                     │
                     │ claim_staker_rewards
                     v
┌────────────────────────────────────────────────────┐
│  CLAIMED                                            │
│                                                    │
│  claimable = earned_rewards - claimed_rewards       │
│  Transfer tokens: market ATA → user wallet          │
│  claimed_rewards += claimable                       │
│                                                    │
│  → Returns to SYNCED state for next period          │
└────────────────────────────────────────────────────┘
```

---

## State Diagram: Off-Chain Period Processing

```
┌──────────┐     ┌────────────┐     ┌──────────┐     ┌───────────┐
│  queued  │ ──> │ processing │ ──> │ tx-sent  │ ──> │ claimable │
└──────────┘     └─────┬──────┘     └──────────┘     └───────────┘
                       │
                       │ (no rewards to distribute)
                       v
                  ┌─────────┐
                  │  empty  │
                  └─────────┘

Backend creates TokenRewardsPeriod with status "queued"
tx-tracker service picks up, submits on-chain close_market_period
On confirmation: status → "claimable"
If no options accrued: status → "empty"
```

---

## The Leaderboard: Connecting Watch Time to Rewards

### Score Calculation

Each creator's monthly score is calculated from their viewers' authenticated watch time, weighted by viewer type:

| Viewer Type | Multiplier | Why |
|---|---|---|
| Anonymous | 0x | Not verified, excluded |
| Signed-in user | 1x | Base verification |
| Follower | 1.25x | Signal of ongoing interest |
| Subscriber | 6x | Strong commitment signal |
| Staker | 9x | Highest — skin in the game |

**Score formula:** `sum(viewer_minutes × viewer_multiplier)` for all viewers of that creator in the month.

The multiplier system creates a virtuous cycle: stakers who watch contribute 9x to a creator's score, incentivizing creators to cultivate staker-viewers specifically.

### Placement and Mint Percentage

At period close, the admin determines each creator's leaderboard position and assigns a mint percentage:

| Position | Mint % | Position | Mint % |
|---|---|---|---|
| 1st | 100% | 14th | 48% |
| 2nd | 96% | 15th | 44% |
| 3rd | 92% | 16th | 40% |
| 4th | 88% | 17th | 36% |
| 5th | 84% | 18th | 32% |
| 6th | 80% | 19th | 28% |
| 7th | 76% | 20th | 24% |
| 8th | 72% | 21st | 20% |
| 9th | 68% | 22nd | 16% |
| 10th | 64% | 23rd | 12% |
| 11th | 60% | 24th | 8% |
| 12th | 56% | 25th | 4% |
| 13th | 52% | Below 25th | 0% (options roll over) |

**Formula:** `mint_percentage = 100 - (position - 1) × 4` for positions 1-25.

**Unminted options roll over.** If a creator places 10th (64% minted), the remaining 36% of their exercisable options carry forward to the next period. Nothing is lost — it just takes longer to realize.

---

## Creator Payout Split

Each creator configures how rewards are divided between themselves and their stakers.

### Default Split

- Creator: 70%
- Stakers: 30%

### Configurable Range

- 0% to 100% in 5% increments
- 0% = all rewards go to stakers
- 100% = all rewards go to creator

### Asymmetric Change Rules

| Direction | When It Takes Effect | Rationale |
|---|---|---|
| Decrease (benefits stakers) | Immediately | Pro-staker changes should be instant |
| Increase (benefits creator) | Start of next month | Prevents abuse: creator can't spike their share mid-period after stakers have already committed |

### On-Chain Implementation

- Decreases: On-chain transaction submitted immediately, `update_index()` called first to settle pending accruals under old rate
- Increases: Off-chain database updated only; on-chain change applied at next month start by admin

---

## How Options Are Held by the Program (Not Users)

This is a critical design point that must be communicated accurately.

**Options tokens are never distributed directly to user wallets.** The flow is:

1. Options accrue as an abstract counter (`exercisable_options`, a u128) on the market account
2. At period close, `mint_options` CPI mints option tokens to the **market's ATA** (a PDA-controlled token account)
3. `exercise_options` CPI immediately exercises those options into **real creator tokens** in the same market ATA
4. The market PDA holds all reward tokens until users explicitly claim
5. Creator calls `claim_creator_rewards` → tokens transfer from market ATA to creator wallet
6. Staker calls `accrue_position_rewards` then `claim_staker_rewards` → tokens transfer from market ATA to staker wallet

**Why this matters for communication:**
- Never say "options are sent to your wallet" — they are exercised by the program and held as real tokens
- Never say "options accrue in your wallet" — they accrue on the market account
- Correct framing: "Options accrue on your staked position. When a period closes, the protocol converts them into real creator tokens that you can claim."

---

## Options Accrual Math

From the on-chain source (`xeenon_market.rs`):

```
yearly_options_accrual_bps = 1000  (default, = 10% per year)
seconds_in_year = 31,536,000

options_per_second_per_token = yearly_options_accrual_bps / 10000 / seconds_in_year

For each time delta:
  options_per_token = options_per_second_per_token × time_delta_seconds
  total_new_options = options_per_token × total_deposited

Split:
  creator_options = options_per_token × creator_rewards_share_percentage / 100
  staker_options = options_per_token - creator_options

Updates:
  exercisable_options += total_new_options
  stakers_index += staker_options_per_token
  creator_accrued_reward_shares += creator share of new options
  stakers_accrued_reward_shares += staker share of new options
```

The `yearly_options_accrual_bps` parameter is set at the market group level and is DAO-controlled. The default of 1000 bps (10%) means 100M staked tokens accrue approximately 10M exercisable options per year.

---

## Real-Time UI Estimate

The extension and website show a live rewards estimate:

```typescript
projectedOptions = (deposits × timeDelta × yearlyOptionsAccrualBps) / 10000 / secondsInYear
creatorProjected = (projectedOptions × creatorRewardsSharePercentage) / 100
stakersProjected = (projectedOptions × (100 - creatorRewardsSharePercentage)) / 100
```

This estimate updates every 1 second in the UI, fetches fresh on-chain data every 10 minutes.

---

## The Virtuous Cycle

The entire system creates reinforcing incentives:

```
More stakers    ──>  More options accruing    ──>  Bigger reward pool
     ^                                                    │
     │                                                    v
     │                                             Creator earns more
     │                                                    │
     │                                                    v
     │                                        Creator promotes their token
     │                                                    │
     │                                                    v
More watchers   ──>  Higher leaderboard score ──>  Higher mint percentage
     │                                                    │
     │                                                    v
     └──────── More viewers become stakers (9x multiplier incentive)
```

Stakers who also watch provide 9x leaderboard value, making their creator's rewards bigger, which makes staking more attractive, which brings more stakers.

---

## Key Accounts (On-Chain)

| Account | PDA Seeds | Key Fields |
|---|---|---|
| XeenonMarketGroup | `["market_group", mayflower_market_group]` | `yearly_options_accrual_bps` |
| XeenonMarket | `["market", mayflower_market_metadata]` | `exercisable_options`, `creator_rewards_share_percentage`, `current_period`, `total_deposited`, `stakers_index` |
| XeenonPosition | `["position", xeenon_market, owner]` | `deposited_amount`, `staged_rewards_shares`, `earned_rewards`, `claimed_rewards`, `last_seen_period` |
| XeenonMarketPeriod | `["market_period", xeenon_market, period]` | `stakers_index`, `stakers_accrued_reward_shares`, `total_stakers_rewards` |

---

## Key Instructions (On-Chain)

| Instruction | Who Calls | What It Does |
|---|---|---|
| `close_market_period` | Admin (super_admin) | Closes period, mints/exercises options, distributes rewards |
| `deposit_token` | User | Stakes creator tokens into market |
| `withdraw_token` | User | Unstakes creator tokens from market |
| `accrue_position_rewards` | User | Converts staged shares to earned rewards after period close |
| `claim_creator_rewards` | Creator | Claims creator's share of reward tokens |
| `claim_staker_rewards` | Staker | Claims staker's share of reward tokens |
| `change_market_creator_rewards_share` | Creator | Changes the creator/staker split |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 800 | InsufficientStakedBalance | Not enough staked to withdraw |
| 802 | InvalidMintPercentageOptions | Must be 4-100% |
| 803 | InvalidCreatorRewardsSharePercentage | Must be 0-100% |
| 808 | InvalidPeriodProvided | Wrong period number |
| 810 | PeriodNotClosed | Operation needs a closed period |
| 811 | PeriodMismatch | Position period != market period |
| 812 | NoRewardsToClaim | Nothing available |

---

## Events

| Event | Fields |
|---|---|
| MarketPeriodClosedEvent | period, timestamp, mint_token, stakers_rewards, creator_rewards |
| ClaimCreatorRewardsEvent | payer, mint_token, amount, accumulated_claims |
| ClaimStakerRewardsEvent | payer, mint_token, amount, accumulated_claims |
| ChangeMarketCreatorRewardsShareEvent | new_percentage, market, timestamp |

---

## Source Files

### On-Chain (Solana programs)
Key modules in the tokens program:
- Market state + accrual math: `programs/tokens/src/state/xeenon_market.rs`
- Position state: `programs/tokens/src/state/xeenon_position.rs`
- Period snapshot: `programs/tokens/src/state/xeenon_market_period.rs`
- Market group config: `programs/tokens/src/state/xeenon_market_group.rs`
- Close period: `programs/tokens/src/instructions/close_market_period.rs`
- Accrue rewards: `programs/tokens/src/instructions/accrue_position_rewards.rs`
- Creator claim: `programs/tokens/src/instructions/claim_creator_rewards.rs`
- Staker claim: `programs/tokens/src/instructions/claim_staker_rewards.rs`
- Change split: `programs/tokens/src/instructions/change_market_creator_rewards_share.rs`
