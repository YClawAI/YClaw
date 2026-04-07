#!/bin/sh
# YCLAW container health check script.
# Called by Docker HEALTHCHECK to verify the core service is responsive.
# Exit 0 = healthy, exit 1 = unhealthy.

set -e

curl -sf http://localhost:"${PORT:-3000}"/health > /dev/null 2>&1 || exit 1
