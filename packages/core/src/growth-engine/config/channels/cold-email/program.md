# Cold Email Experiment Loop

## Goal
Maximize positive reply rate from Web3 developer leads.

## Scoring Rule
- Metric: positive_reply_rate = (positive_replies / total_sent) * 100
- Scoring window: 72 hours after send
- Win threshold: > baseline positive_reply_rate by >= 0.5 percentage points
- Minimum sample: 100 sends per variant

## Variables to Test (one at a time)
1. subject_line — tone, length, personalization, angle
2. opening — formality, personalization depth, hook
3. value_prop — technical vs. business framing, specificity, social proof
4. cta — ask type (demo, call, reply, link), urgency, commitment level

## Constraints
- MUST pass baseline.md compliance check before deploy
- Maximum 1 variable changed per experiment
- Send volume: 100 emails per variant
- Cool-down between variants: 24 hours minimum
