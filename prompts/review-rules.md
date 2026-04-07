<!-- CUSTOMIZE: Content review and approval rules -->
# Content Review Rules

> Governs auto-publish permissions across content-producing agents.
> Defines what gets published automatically vs what needs human review.

---

## 1. Review Queue Architecture

### Routing States

```
Agent generates content
    ↓
    Tags with: agent, confidence, template, platform
    ↓
    Routes based on rules below
    ↓
    ├─ AUTO: publishes immediately (no human intervention needed)
    ├─ TIMED: queues for review window, auto-publishes if no rejection
    ├─ REVIEW: holds until explicitly approved
    └─ BLOCKED: never auto-publishes, always requires approval
```

| Route | Behavior | Timeline |
|-------|----------|----------|
| **AUTO** | Publishes immediately | Real-time |
| **TIMED** | Queued [X] minutes | Review window |
| **REVIEW** | Held pending | Until approval |
| **BLOCKED** | Never auto-publishes | Until approval |

---

## 2. Per-Agent Rules

### Content Agent (e.g., Ember)

| Action | Platform | Confidence | Route |
|--------|----------|------------|-------|
| Short post | [Platform] | ≥85% | AUTO |
| Medium post | [Platform] | ≥80% | TIMED |
| Thread | Any | Any | REVIEW |
| Official statement | Any | Any | BLOCKED |

### Community Agent (e.g., Keeper)

| Action | Situation | Route |
|--------|-----------|-------|
| FAQ response | High match to KB | AUTO |
| Spam deletion | Clear spam signature | AUTO |
| Ban action | Any | REVIEW |

### Growth Agent (e.g., Scout)

| Action | Route | Notes |
|--------|-------|-------|
| Internal research | AUTO | Documentation only |
| ALL outreach | BLOCKED | Requires executive approval |

---

## 3. Forbidden Content

**NEVER publish, regardless of route or confidence score:**

- Financial predictions or investment advice
- Unverified partnership or endorsement claims
- Competitive attacks by name
- Banned terminology (define your list)
- Security or privacy details
- Political or controversial statements

---

## 4. Confidence Scoring

```
Confidence = (Relevance + Brand Fit + Quality + Sentiment) / 4
```

Each component 0-100%.

---

## 5. Escalation

| Time Since Posted | Action |
|-------------------|--------|
| 0-1 hour | Initial notification |
| 1 hour | Reminder |
| 4 hours | Second reminder |
| 24 hours | Content expires |

---

## 6. Emergency Controls

```
/pause_all    → All auto-publishing paused
/resume_all   → Resume normal publishing
/crisis_mode  → Only REVIEW/BLOCKED active
```

---
> See `examples/gaze-protocol/prompts/review-rules.md` for a comprehensive real-world example with per-agent routing tables.
