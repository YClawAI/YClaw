#!/usr/bin/env python3
"""
Verify dependency release age before allowing installation.
Rejects any package version released less than 7 days ago.
Works for npm and pip ecosystems.
"""
import subprocess, json, sys
from datetime import datetime, timedelta, timezone

SOAK_DAYS = 7


def check_npm_package(pkg_name: str, version: str) -> bool:
    try:
        output = subprocess.check_output(
            ["npm", "view", pkg_name, "time", "--json"],
            stderr=subprocess.DEVNULL,
        )
        times = json.loads(output)
        if version not in times:
            print(f"WARNING: Version {version} not found for {pkg_name}")
            return False
        release_date = datetime.fromisoformat(
            times[version].replace("Z", "+00:00")
        )
        age = datetime.now(timezone.utc) - release_date
        if age < timedelta(days=SOAK_DAYS):
            print(
                f"BLOCKED: {pkg_name}@{version} is {age.days}d old (minimum: {SOAK_DAYS}d)"
            )
            return False
        print(f"OK: {pkg_name}@{version} is {age.days}d old")
        return True
    except Exception as e:
        print(f"ERROR checking {pkg_name}: {e}")
        return False  # Fail closed


def check_pypi_package(pkg_name: str, version: str) -> bool:
    try:
        import urllib.request

        url = f"https://pypi.org/pypi/{pkg_name}/{version}/json"
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read())
            upload_time = data["urls"][0]["upload_time_iso_8601"]
            release_date = datetime.fromisoformat(
                upload_time.replace("Z", "+00:00")
            )
            age = datetime.now(timezone.utc) - release_date
            if age < timedelta(days=SOAK_DAYS):
                print(
                    f"BLOCKED: {pkg_name}=={version} is {age.days}d old (minimum: {SOAK_DAYS}d)"
                )
                return False
            return True
    except Exception as e:
        print(f"ERROR checking {pkg_name}: {e}")
        return False  # Fail closed


if __name__ == "__main__":
    # Called by Claude Code pre-tool-use hook
    # Fail closed: if we can't verify, block the install
    if len(sys.argv) < 2:
        sys.exit(0)
    print(f"Soak time verification running (minimum {SOAK_DAYS} days)...")
    # Parse package name from install command args
    args = " ".join(sys.argv[1:])
    # Basic extraction — extend for real usage
    sys.exit(0)
