# X Algorithm Optimization — Ember Skill

> **Source:** https://github.com/twitter/the-algorithm (open source, default branch: `main` NOT `master`)
> **Last researched:** SEED — awaiting first Scout x_algorithm_research cycle
> **Update cadence:** Monthly (1st of each month via Scout)

---

## How This Skill Works

Scout researches the X algorithm repo and community discussion monthly, then publishes
findings via `scout:intel_report`. When you receive algo-related intel, update this file
with new findings using `github:commit_file`. Reference these rules when crafting all
X content.

---

## Ranking Signals (from open-source algo + community testing)

### Engagement Scoring (TweepCred + RealGraph)
- **Replies** are weighted heaviest (~27x a like in early versions)
- **Retweets with quote** > plain retweets
- **Bookmarks** are a strong signal (private engagement = genuine interest)
- **Dwell time** — how long someone stays on your tweet matters
- **Profile clicks** from a tweet are a positive signal

### Content Format Signals
- **Threads** (2-5 tweets) outperform single tweets for reach
- **Images** boost engagement ~2x over text-only
- **Video** gets priority in the algorithm but must hook in first 3 seconds
- **Links in tweets** are suppressed — put links in replies, not the main post
- **Alt text on images** is a minor positive signal

### Text Optimization
- **Optimal length:** 71-100 characters for single tweets, up to 280 for threads
- **Questions** drive reply engagement (algo's highest-weight signal)
- **No hashtag spam** — 1-2 relevant hashtags max. 0 often outperforms 3+
- **Line breaks** improve dwell time (more readable = longer on-screen)

### Timing & Cadence
- **Don't delete and repost** — algo tracks this negatively
- **2-4 posts/day** is the sweet spot. More than 6 dilutes per-post reach
- **Reply to your own threads** within 1 hour to boost the chain
- **Engage with replies** within first 30 min — early engagement velocity matters

### What Gets Suppressed
- External links in main tweet body
- Excessive hashtags (>3)
- Duplicate/near-duplicate content
- High volume posting (>8/day)
- Content flagged by safety classifiers

### What Gets Boosted
- Content from accounts with high follower engagement ratio
- Tweets that generate conversation (replies >> likes)
- Content in topics the viewer already engages with (topic clustering)
- Tweets from accounts the viewer has interacted with recently (RealGraph)

---

## YClaw-Specific Application

Given our brand voice (warm restraint, no exclamation marks, no hype):
- **End threads with a question** — drives replies without being engagement bait
- **Use images from Forge** — 2x boost, and they're on-brand
- **Put yclaw.ai links in reply to thread, not in thread itself**
- **Bookmark-worthy content** — educational explainers get saved, which algo loves
- **Respond to every genuine reply** within 30 min of posting

---

## Validation Notes

*This section tracks what actually works for @YClaw_ai vs what the algo says should work.*
*Update after reviewing post performance via x:lookup.*

No data yet — awaiting first content cycle.

---

*This file is maintained by Ember based on Scout's monthly x_algorithm_research reports.
Do not edit manually — let the research → skill pipeline handle updates.*
