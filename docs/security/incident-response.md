# Incident Response Playbook

## Supply Chain Compromise Response

### 1. Detection (T+0)

Sources:
- Socket.dev alert (behavior-based detection)
- Snyk/Trivy vulnerability scan
- GitHub Dependabot security advisory
- Community report (X, HackerNews, security mailing lists)
- OpenSSF Scorecard degradation

### 2. Triage (< 15 minutes)

1. **Determine if YCLAW uses the affected package/version:**
   ```bash
   # Check SBOM artifact from latest CI build
   gh run download --name sbom --dir /tmp/sbom
   jq '.packages[] | select(.name == "PACKAGE_NAME")' /tmp/sbom/sbom.spdx.json

   # Or check lockfile directly
   grep -c "PACKAGE_NAME" package-lock.json
   npm ls PACKAGE_NAME
   ```

2. **Assess blast radius:**
   - Is this a direct dependency or transitive?
   - Which services/packages import it?
   - Does it run during CI, build, or runtime?

3. **Classify severity:**
   | Severity | Criteria | Response Time |
   |----------|----------|---------------|
   | CRITICAL | Active exploitation, credential theft, RCE | Immediate |
   | HIGH     | Code execution possible, data exfil capability | < 1 hour |
   | MEDIUM   | Behavior anomaly, no confirmed exploitation | < 4 hours |
   | LOW      | Deprecated, unmaintained, theoretical risk | Next business day |

### 3. Containment (< 1 hour for CRITICAL/HIGH)

1. **Pause all agent CI/CD activity:**
   ```bash
   # Disable reaction loop
   # Set REACTION_LOOP_ENABLED=false in ECS task definition
   aws ecs update-service --cluster yclaw-cluster-production \
     --service yclaw-production --force-new-deployment

   # Or emergency: stop all ECS tasks
   aws ecs update-service --cluster yclaw-cluster-production \
     --service yclaw-production --desired-count 0
   ```

2. **Revoke and rotate all exposed credentials:**
   - GitHub PATs
   - AWS access keys (if non-OIDC)
   - API keys in Secrets Manager
   - npm tokens

3. **Pin to last-known-good lockfile:**
   ```bash
   git log --oneline package-lock.json  # Find last known good
   git checkout <good-sha> -- package-lock.json
   npm ci --ignore-scripts
   ```

4. **Block the package in Socket.dev and .yclaw/approved-dependencies.json blocklist**

### 4. Eradication

1. Remove or replace the compromised dependency
2. Update lockfile: `rm package-lock.json && npm install`
3. Re-scan with Trivy and Socket.dev
4. Verify no persistence mechanisms were installed:
   ```bash
   # Check for unexpected files
   git status
   git diff HEAD~5 --stat

   # Check for suspicious postinstall artifacts
   find node_modules -name "*.sh" -newer package-lock.json
   find /tmp -newer package-lock.json -type f 2>/dev/null
   ```

### 5. Recovery

1. Staged rollout of fixed version
2. Verify all agents are operational
3. Re-enable reaction loop
4. Monitor CloudWatch and Slack alerts for 24 hours

### 6. Post-Incident

1. Update blocklist in `.yclaw/approved-dependencies.json`
2. Document in security changelog
3. Review: would the 7-day soaking period have caught this?
4. Review: did Socket.dev detect the behavior?
5. Update this playbook with lessons learned

## Agent Compromise Response

If an agent is suspected of being compromised (unexpected PRs, unusual network activity):

1. **Immediately disable the agent** — remove from ECS task definition
2. **Revoke its credentials** — rotate all tokens it had access to
3. **Audit recent activity** — review all PRs, commits, and actions from the last 72 hours
4. **Check for self-modification** — verify no changes to CODEOWNERS, workflows, safety guards
5. **Review circuit breaker logs** — was the breaker tripped? Was it bypassed?

## Contact

Security issues: Open a private security advisory on the GitHub repository.
Emergency: Contact @yclaw-admins in the organization.
