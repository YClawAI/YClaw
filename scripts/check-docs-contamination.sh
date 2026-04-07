#!/usr/bin/env bash
# Check for stale/incorrect terminology in documentation files.
# Run this before committing doc changes or as a CI step.
# Exits 0 if clean, 1 if contamination found.
#
# Usage: ./scripts/check-docs-contamination.sh [directory]
# Default directory: repo root

set -euo pipefail

DIR="${1:-.}"
ERRORS=0

# Files to check (exclude reference/ which is historical)
CHECK_PATHS=(
  "$DIR/CLAUDE.md"
  "$DIR/AGENTS.md"
  "$DIR/SOUL.md"
  "$DIR/.ai"
  "$DIR/prompts"
)

# Build the list of paths that actually exist
EXISTING_PATHS=()
for p in "${CHECK_PATHS[@]}"; do
  [[ -e "$p" ]] && EXISTING_PATHS+=("$p")
done

if [[ ${#EXISTING_PATHS[@]} -eq 0 ]]; then
  echo "No documentation paths found in $DIR"
  exit 0
fi

check_pattern() {
  local label="$1"
  local pattern="$2"
  local exclude_pattern="$3"
  local context="${4:-}"

  # Search across all existing doc paths, excluding reference/
  local matches
  matches=$(grep -rn --include='*.md' -E "$pattern" "${EXISTING_PATHS[@]}" 2>/dev/null \
    | grep -v 'reference/' \
    | grep -v 'check-docs-contamination' \
    || true)

  if [[ -n "$matches" ]]; then
    # Filter out lines matching the exclude pattern (warnings, rules docs, etc.)
    local real_matches
    if [[ -n "$exclude_pattern" ]]; then
      real_matches=$(echo "$matches" \
        | grep -ivE "$exclude_pattern" \
        || true)
    else
      real_matches="$matches"
    fi

    if [[ -n "$real_matches" ]]; then
      echo "FAIL: $label"
      [[ -n "$context" ]] && echo "  ($context)"
      echo "$real_matches" | while IFS= read -r line; do
        echo "  $line"
      done
      echo ""
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

echo "Checking documentation for stale terminology..."
echo "Directory: $DIR"
echo "---"

# Pattern 1: GZC / Crediez used as active terminology
# Exclude: lines warning NOT to use these terms
check_pattern \
  "Crediez/GZC used as active currency" \
  '\bGZC\b|Crediez' \
  '(not |no |never |don.t |replaced|instead of|historical|warning|outdated)' \
  "USDC is the buy/sell currency. Crediez was removed."

# Pattern 2: Hardcoded options accrual rate in marketing/copy
# Exclude: technical protocol docs referencing the DAO parameter
check_pattern \
  "Hardcoded options accrual rate" \
  '10%(/| per )year|10%/yr' \
  '(DAO|bps|parameter|yearly_options_accrual|not |never )' \
  "Accrual rate is DAO-controlled. Never hardcode in marketing copy."

# Pattern 3: Options/rewards auto-distributed to wallet
# Exclude: lines that say NOT to use this phrasing
check_pattern \
  "Claims rewards are auto-distributed" \
  'distributed to (your |the )?wallet|sent to (your |the )?wallet|arrive in your wallet' \
  '(not |never |don.t |instead)' \
  "Options are held by the market program. Users must actively claim."

# Pattern 4: SOL as buy/sell currency (not gas)
# Exclude: lines warning NOT to use SOL
check_pattern \
  "SOL used as buy/sell currency" \
  'price:.*SOL|buy.*with SOL|sell.*for SOL|cost.*SOL|spend SOL|pay.*SOL|\bSOL\b.*bonding' \
  '(Not SOL|not SOL|instead of SOL)' \
  "USDC is the buy/sell currency. SOL is only for gas fees."

# Pattern 5: Platform instead of protocol
check_pattern \
  "Called YClaw a 'platform'" \
  'YClaw (is a|the) platform|YClaw platform' \
  '' \
  "YClaw is a protocol, not a platform."

# Pattern 6: Banned hype terms in user-facing copy
# Only check files that contain publishable content (not rules, watchlists, moderation docs)
# Exclude: brand voice banned-terms tables, review rules, moderation examples,
#          competitor analysis, hashtag guidance, library names (Web3.js),
#          outreach templates listing what NOT to do, tech stack descriptions
check_pattern \
  "Banned hype terminology in copy" \
  '\brevolutionary\b|\bgame.changing\b|\bWeb3\b|\bmoon\b|\bWAGMI\b|\bdegen\b|\bape in\b|\bpassive income\b' \
  '(brand.voice|review.queue|review.rules|moderation.rules|competitor.watchlist|platform.guide|outreach.templates|autonomous.ops|soul\.md|Web3\.js|Web3 social|Blockchain:|blockchain|hashtag|#Web3|❌|Overused|Empty|Same\.|claim .* is|tech.stack|Tech Stack|[Nn]ever use|will never|see brand|Never say|antidote|addiction|[Nn]ot passive|[Nn]o hype|participate in|label\.|Regulatory|audience voice|not "join|"earn tokens")' \
  "These terms are banned per brand voice guidelines."

echo "---"
if [[ $ERRORS -eq 0 ]]; then
  echo "PASS: All documentation checks passed."
  exit 0
else
  echo "FAIL: $ERRORS contamination pattern(s) found. Fix before committing."
  exit 1
fi
