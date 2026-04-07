# SECURITY: Pinned to v1.82.3-stable — last known-safe release.
# DO NOT upgrade until BerriAI confirms remediation of the supply chain attack.
# See: https://github.com/BerriAI/litellm/issues/24512
#      https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/
#
# Compromised versions: 1.82.7, 1.82.8 (PyPI + GHCR main-latest)
# Maintainer account (krrishdholakia) believed compromised as of 2026-03-24.
# PyPI has quarantined the package.
FROM ghcr.io/berriai/litellm:main-v1.82.3-stable

# Install curl for ECS health checks (wolfi-based image uses apk)
RUN apk add --no-cache curl || pip install httpie

# Copy provider config into the image at the path LiteLLM expects.
# API keys are NOT embedded here — they are injected at runtime from
# AWS Secrets Manager via ECS task definition secrets.
COPY litellm_config.yaml /app/config.yaml

# Override CMD to point at our config and bind to all interfaces.
CMD ["--config", "/app/config.yaml", "--port", "4000", "--host", "0.0.0.0"]
