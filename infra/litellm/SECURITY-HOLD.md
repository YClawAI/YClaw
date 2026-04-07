# ⛔ LiteLLM Security Hold — Supply Chain Attack (2026-03-24)

## Status: DO NOT UPGRADE

LiteLLM PyPI versions **1.82.7** and **1.82.8** contain a malicious `.pth` file (`litellm_init.pth`) that:
1. **Steals credentials** — SSH keys, AWS/GCP/Azure creds, env vars, .env files, K8s secrets, crypto wallets
2. **Exfiltrates** to `https://models.litellm.cloud/` (attacker-controlled, NOT litellm.ai)
3. **Lateral movement** — reads all K8s cluster secrets, creates backdoor pods in kube-system
4. **Persistence** — installs `~/.config/sysmon/sysmon.py` + systemd service

## Our Exposure
- **NOT compromised** — ECR image last pushed March 3 (pre-attack), service currently offline for rebuild
- Dockerfile pinned to `v1.82.3-stable` as a safety measure
- YClaw agents talk to LiteLLM over HTTP (TypeScript → fetch), NOT Python import

## Tracking
- GitHub issue: https://github.com/BerriAI/litellm/issues/24512 (closed as "not planned" — suspicious)
- Analysis: https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/
- PyPI status: Package quarantined
- Maintainer account (@krrishdholakia) potentially compromised

## Resume Criteria
Before upgrading LiteLLM again, ALL of:
- [ ] BerriAI issues official post-mortem with root cause
- [ ] PyPI quarantine lifted
- [ ] New release verified clean (check for `.pth` files in wheel)
- [ ] Community consensus that the project is safe
- [ ] Human approval from Troy

## Verification Command
```bash
# Check any litellm wheel for .pth files (should return empty)
pip download litellm==<VERSION> --no-deps -d /tmp/check
python3 -c "
import zipfile, os
whl = '/tmp/check/' + [f for f in os.listdir('/tmp/check') if f.endswith('.whl')][0]
with zipfile.ZipFile(whl) as z:
    pth = [n for n in z.namelist() if n.endswith('.pth')]
    print('PTH files:', pth)
    if pth: print('⛔ MALICIOUS — DO NOT USE')
    else: print('✅ No .pth files found')
"
```
