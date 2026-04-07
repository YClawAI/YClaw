---
name: rlm
description: "Process large codebases (>100 files) using parallel map-reduce. Treats code as external environment, prevents context rot."
metadata:
  version: 1.0.0
  type: on-demand
---

# Recursive Language Model (RLM)

Process large codebases without context rot via parallel map-reduce.

**Core principle:** Context is an external resource, not a local variable.

## Protocol

### 1. Index & Filter
Identify relevant files without loading them:
- Use grep/find to build file lists
- Never read > 3-5 files into main context

### 2. Parallel Map
Split work into atomic units, process in parallel:
- Give each sub-task ONE specific chunk or file
- Launch 3-5 parallel agents for broad tasks

### 3. Reduce & Synthesize
Combine results into coherent answer:
- Collect all outputs
- Look for patterns and consensus
- If incomplete, recurse on missing pieces

## Anti-Patterns

- **Monolithic**: Reading all files sequentially (context degrades)
- **Overloading**: Giving one agent too many files
- **Skipping filter**: Processing irrelevant files wastes context
