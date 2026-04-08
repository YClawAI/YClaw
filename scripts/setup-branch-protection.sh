#!/usr/bin/env bash
# Sets up branch protection on YClawAI/yclaw main branch.
#
# Requires:
#   - gh CLI authenticated with admin access on the target repo
#   - Repo must be public (GitHub free plan limits branch protection to public repos)
#
# Run AFTER making the repo public.
#
# Required status check contexts must match exactly what GitHub reports for the
# Checks API. Format is `<workflow name> / <job name>`. For
# .github/workflows/pr-validate.yml (workflow `PR Validation`, job `validate`),
# the context is `PR Validation / validate`. To verify after a PR runs:
#   gh api "repos/$REPO/commits/$SHA/check-runs" -q '.check_runs[].name'

set -euo pipefail

REPO="${REPO:-YClawAI/yclaw}"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is not installed" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

echo "Applying branch protection on $REPO main..."

gh api "repos/$REPO/branches/main/protection" \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["PR Validation / validate"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
EOF

echo "Branch protection enabled on $REPO main"
