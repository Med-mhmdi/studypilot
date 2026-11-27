# CI security checks

The `Security checks` GitHub Actions workflow runs two independent scans:

1. **Gitleaks** scans the complete Git history for credentials and other secret patterns. Its output is redacted, and the scan fails when it finds a match. This catches secrets committed earlier as well as in the latest change.
2. **pip-audit** checks the Python application and development requirements against published vulnerability advisories. The audit fails when a vulnerable dependency is found.

Both jobs run for pull requests into `main`, pushes to `main` or `feature/*` branches, and manual runs. They only receive `contents: read`; they do not receive Dokku credentials or Kubernetes access. The dependency job uses Python 3.12, matching the existing test pipeline. Reports are uploaded as separate artifacts for 14 days, including when a scan reports a finding.

The initial audit found that the old Pillow version range could resolve to Pillow 12.3.0, which had known advisories. The range now requires Pillow 13.0.0 or newer within the 13.x series, and the follow-up audit found no known vulnerable packages.

## How to demonstrate this assignment

1. Open **Actions → Security checks** and show the two independent jobs.
2. Open the workflow YAML and explain the `pull_request` and `push` triggers, read-only permissions, and each scanner step.
3. Show the latest run and its result. If a check fails, open its report artifact, review the finding, and fix the exposed credential or upgrade the affected dependency before treating the pipeline as clean.
4. Explain that Gitleaks detects secret-like values in Git history, while pip-audit checks package versions against known vulnerability advisories.

The project uses version ranges rather than a Python lockfile, so pip-audit resolves versions allowed by the current requirements each time it runs. A lockfile would make dependency resolution reproducible. A clean audit means no known advisory matched the resolved packages at that run; it cannot prove that the application has no security issues.
