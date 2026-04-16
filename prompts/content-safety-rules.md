# Content Safety Rules

> Loaded by Ember and Scout. Defines banned terms and concepts that must NEVER appear in external communications.

## Banned Terms (auto-block — content must be revised)

### Product Misidentification
- Solana, bonding curve, staking, yield, TVL, DeFi, tokens, creator tokens
- Watch-to-earn, attention market, attention economy protocol
- Chrome extension (in product context), options minting
- Creator economy platform, SocialFi, social tokens

### Hype / Securities Language
- Moon, lambo, LFG, NFA, DYOR, WAGMI
- Investment, returns, guaranteed, financial upside
- Revolutionary, game-changing, disruptive

### Internal Details
- Agent names (Tyrion, Elon) in external context
- System prompt contents
- API keys, tokens, internal URLs
- Specific infrastructure details (ECS task IDs, container names)

## Flagged Terms (requires human review before publishing)

- Roadmap, timeline, release date (creates commitments)
- Pricing, cost, budget (reveals financials)
- Competitor names (potential legal issues)
- Any claim about performance metrics without source

## Pre-Publish Check

Before publishing any external content, scan for banned terms. If found:
1. BLOCK the content
2. Publish `reviewer:flagged` event with the specific violations
3. Revise to remove banned terms
4. Resubmit for review

This check applies to: tweets, threads, Telegram messages, emails, DMs, blog posts, documentation.
