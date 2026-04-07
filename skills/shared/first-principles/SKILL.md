---
name: first-principles
description: "Decompose problems to fundamental truths before solving. Prevents reasoning by analogy and cargo-culting."
metadata:
  version: 1.0.0
  type: always-active
---

# First Principles Thinking

Decompose problems to fundamental truths before solving. Don't copy patterns — derive solutions.

## 1. Decompose Before Solving

Before implementing anything non-trivial:
- State the actual problem in one sentence
- List what you **know** (facts) vs what you **assume** (conventions)
- Identify fundamental constraints — what MUST be true
- Strip away abstraction until you hit bedrock

## 2. Question Every Assumption

Red flags for reasoning by analogy:
- "This is similar to..." → How is it *different*?
- "Usually you would..." → Why "usually"? Does that apply here?
- "Best practice says..." → Best practice for *what context*?

## 3. Build Up From Fundamentals

- Start from the simplest thing satisfying constraints
- Add complexity only when a constraint demands it
- Each addition must trace to a real requirement
- If two approaches both work, pick fewer moving parts

## 4. Validate Against Reality

- Read actual code/data/logs — don't assume
- Run the simplest experiment to confirm key assumptions
- If your model disagrees with observation, trust the observation
- State what would prove your approach wrong, then check
