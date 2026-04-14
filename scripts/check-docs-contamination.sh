#!/usr/bin/env bash
# Check for stale/incorrect terminology in documentation and prompt files.
# Run this before committing doc changes or as a CI step.
# Exits 0 if clean, 1 if contamination found.
#
# Usage: ./scripts/check-docs-contamination.sh [directory]
# Default directory: repo root

set -euo pipefail

DIR="${1:-.}"
ERRORS=0

# Files to check
CHECK_PATHS=(
  "$DIR/prompts"
  "$DIR/CLAUDE.md"
  "$DIR/docs"
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

  local matches
  matches=$(grep -rn --include='*.md' -Ei "$pattern" "${EXISTING_PATHS[@]}" 2>/dev/null \
    | grep -v 'check-docs-contamination' \
    | grep -v 'reference/' \
    || true)

  if [[ -n "$matches" ]]; then
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

echo "Checking documentation for Gaze/DeFi contamination..."
echo "Directory: $DIR"
echo "---"

# Pattern 1: DeFi terminology used as if YClaw IS a DeFi product
# Exclude: lines that say YClaw is NOT DeFi, banned word lists, review rules
check_pattern \
  "DeFi terminology describing YClaw" \
  '\bdefi\b|\btokenomics\b|\bTVL\b|\bAPY\b|\bAPR\b|\bAMM\b|\bbonding curve\b|\byield farming\b|\bcreator economy\b' \
  '(NOT |not a |not |never |no |banned|We are NOT|What We Are Not|No DeFi|forbidden|guardrail|Don.t|compliance|securities|legal|- A DeFi|- A token|- A creator|- A managed)' \
  "YClaw is AI agent orchestration infrastructure, NOT a DeFi protocol."

# Pattern 2: Gaze-specific terminology
check_pattern \
  "Gaze-specific terms in active content" \
  '\bGZC\b|\bCrediez\b|\bMayflower\b|\bXeenon\b' \
  '(extracted from|origin|historical|was renamed|forked from)' \
  "These are Gaze Protocol terms. YClaw has been scrubbed of Gaze-specific content."

# Pattern 3: Banned hype terms in user-facing copy
check_pattern \
  "Banned hype terminology in copy" \
  '\brevolutionary\b|\bgame.changing\b|\bmoon\b|\bWAGMI\b|\bdegen\b|\bape in\b|\bpassive income\b' \
  '(brand.voice|review.rules|moderation|competitor|banned|Never|never|❌|antidote)' \
  "These terms are banned per brand voice guidelines."

# Pattern 4: Dead references to gaze-protocol examples
check_pattern \
  "Dead gaze-protocol example references" \
  'examples/gaze-protocol' \
  '' \
  "The examples/gaze-protocol/ directory no longer exists."

# Pattern 5: Blank CUSTOMIZE templates that should have been filled
check_pattern \
  "Unfilled template placeholders" \
  '\[Term [0-9]\]|\[KPI [0-9]\]|\[Your primary business|\[Channel [0-9]:|\[your product\]' \
  '' \
  "Template placeholders should be replaced with real content."

echo "---"
if [[ $ERRORS -eq 0 ]]; then
  echo "PASS: All documentation checks passed."
  exit 0
else
  echo "FAIL: $ERRORS contamination pattern(s) found. Fix before committing."
  exit 1
fi
