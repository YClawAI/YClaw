# Landing Page Experiment Loop

## Goal
Maximize landing page conversion rate (CTA clicks / unique visitors).

## Scoring Rule
- Metric: conversion_rate = (cta_clicks / visitors) * 100
- Scoring window: 7 days after deploy
- Win threshold: > baseline conversion_rate by >= 0.5 percentage points
- Minimum sample: 50 unique visitors

## Variables to Test (one at a time)
1. headline — value proposition framing, angle, specificity
2. subheadline — supporting message, credibility signal
3. hero_copy — feature description, pain point emphasis, social proof
4. cta_text — button text, urgency, commitment level

## Constraints
- MUST pass baseline.md compliance check before deploy
- Maximum 1 variable changed per experiment
- A/B split: 50/50 with current champion
- Cool-down between variants: 24 hours minimum
