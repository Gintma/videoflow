# Security

VideoFlow is a local-first tool. API keys are stored in `app-config.local.json`, which is ignored by git.

## Reporting

If you find a security issue, please do not open a public issue containing secrets, exploit details, or private project data. Contact the repository maintainer privately.

## Sensitive Data

Before publishing a fork or sharing logs, check for:

- `app-config.local.json`
- `.env` files
- API keys in shell history or copied logs
- generated files under `projects/`
- private audio, image, video, or font assets

If a secret was committed to git history, rotate the secret first, then rewrite the repository history before publishing.
