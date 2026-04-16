# X Research Skill

General-purpose agentic research over X/Twitter. Decompose research questions into targeted searches, iteratively refine, follow threads, and synthesize into sourced briefings.

Adapted from [rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill).

## Available Actions

Scout uses these built-in actions (not CLI tools):

- **`x:search`** — Search recent tweets (last 7 days). Params: `query` (string), `max_results` (number, max 10)
- **`x:lookup`** — Look up a single tweet by ID. Params: `id` (string)
- **`x:user`** — Look up a user profile. Params: `username` (string)
- **`x:user_tweets`** — Get recent tweets from a user. Params: `username` (string), `max_results` (number)

## Search Operators

| Operator | Example | Notes |
|----------|---------|-------|
| keyword | `bun 2.0` | Implicit AND |
| `OR` | `bun OR deno` | Must be uppercase |
| `-` | `-is:retweet` | Negation |
| `()` | `(fast OR perf)` | Grouping |
| `from:` | `from:elonmusk` | Posts by user |
| `to:` | `to:elonmusk` | Replies to user |
| `#` | `#buildinpublic` | Hashtag |
| `$` | `$AAPL` | Cashtag |
| `lang:` | `lang:en` | Language filter |
| `-is:retweet` | Always add | Filter retweets |
| `-is:reply` | Optional | Filter replies |
| `has:links` | `has:links` | Contains links |
| `url:` | `url:github.com` | Links to domain |

**Not available as operators:** `min_likes`, `min_retweets`. Filter engagement post-hoc from results.

**Max query length:** 512 chars. Keep queries focused.

**Note:** Our X API is Basic tier — some advanced operators may be limited. Always add `-is:retweet` to reduce noise.

## Research Loop

### 1. Decompose the Question

Turn the research question into 3-5 targeted queries:

- **Core query**: Direct keywords for the topic
- **Expert voices**: `from:` specific known experts in the space
- **Pain points**: `(broken OR bug OR issue OR migration)` modifiers
- **Positive signal**: `(shipped OR love OR fast OR benchmark)` modifiers
- **Noise reduction**: Always `-is:retweet`, add `-is:reply` for cleaner results
- **Crypto spam filter**: Add `-airdrop -giveaway -whitelist` for crypto topics

### 2. Search and Assess

Run each query via `x:search`. After each result set:
- **Signal or noise?** Adjust operators for next query.
- **Key voices?** Note usernames worth searching `from:` specifically.
- **High-engagement tweets?** Note tweet IDs for thread lookup.
- **Linked resources?** Note URLs worth investigating via `github:get_contents`.

### 3. Follow Expert Voices

When you identify key voices:
```
x:user_tweets username="{expert}" max_results=10
```

### 4. Deep-Dive Threads

When a tweet is a thread starter or has high engagement:
```
x:lookup id="{tweet_id}"
```

### 5. Synthesize

Group findings by **theme**, not by query:

```markdown
### [Theme/Finding Title]

[1-2 sentence summary]

- @username: "[key quote]" (N likes, N impressions)
- @username2: "[another perspective]" (N likes)

Key resources shared:
- [Resource title](url) — [what it is]
```

### 6. Publish

Publish findings as `scout:intel_report` event for Ember to consume. Save detailed research to repo via `github:commit_file` at `research/YYYY-MM-DD-{topic-slug}.md`.

## Refinement Heuristics

- **Too much noise?** Add `-is:reply`, narrow keywords, use `lang:en`
- **Too few results?** Broaden with `OR`, remove restrictive operators
- **Crypto spam?** Add `-$ -airdrop -giveaway -whitelist`
- **Expert takes only?** Use `from:` operator
- **Substance over hot takes?** Add `has:links`

## Cost Awareness

X API uses pay-per-use pricing:
- Post read: $0.005
- User lookup: $0.010
- A typical research session (5 queries × 10 results) = 50 reads ≈ $0.25

Keep `max_results` at 10 unless deeper research is needed. 24-hour deduplication means re-running the same search is cheaper.

## Competitive Intel Targets

Key accounts and topics to monitor for YCLAW-relevant intel:
- **AI agent frameworks**: `"AI agent framework" (open source OR orchestration OR multi-agent)`
- **Direct competitors**: `"CrewAI" OR "AutoGen" OR "LangGraph" (launch OR update OR enterprise)`
- **Multi-agent systems**: `"multi-agent system" (production OR deploy OR scale)`
- **Agent orchestration**: `"agent orchestration" -crypto -DeFi -token`
- **AI agent governance**: `"AI agents" (department OR coordination OR approval OR governance)`

Update this list as the competitive landscape evolves.
