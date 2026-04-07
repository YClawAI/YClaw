# Twitter/X Experiment Loop

## Goal
Maximize engagement rate (engagements / impressions) on X/Twitter posts.

## Scoring Rule
- Metric: engagement_rate = (engagements / impressions) * 100
- Scoring window: 48 hours after post
- Win threshold: > baseline engagement_rate by >= 0.5 percentage points
- Minimum sample: 1 post per experiment (each post is its own experiment)

## Variables to Test (one at a time)
1. hook — opening line that stops the scroll
2. body — core message and framing
3. cta — call to action or closing
4. format — single-post, thread, or with-media

## Constraints
- MUST pass baseline.md compliance check before posting
- Maximum 1 variable changed per experiment
- Cool-down between posts: 4 hours minimum
- Use SEPARATE X API credentials from Ember's existing integration
