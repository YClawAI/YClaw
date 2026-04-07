---
name: karpathy-guidelines
description: "Behavioral guidelines to reduce common LLM coding mistakes. Simplicity, surgical changes, goal-driven execution."
metadata:
  version: 1.0.0
  type: always-active
---

# Karpathy Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

## 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- If a simpler approach exists, say so.

## 2. Simplicity First

- No features beyond what was asked
- No abstractions for single-use code
- No error handling for impossible scenarios
- If 200 lines could be 50, rewrite it

## 3. Surgical Changes

- Don't "improve" adjacent code
- Don't refactor things that aren't broken
- Match existing style
- Every changed line traces to the request

## 4. Goal-Driven Execution

Transform tasks into verifiable goals:
- "Add validation" → Write tests for invalid inputs, make them pass
- "Fix the bug" → Write a reproducing test, make it pass
- "Refactor X" → Ensure tests pass before and after
