# Contributing

Thanks for considering a contribution to VideoFlow.

## Development

```bash
npm install
cp app-config.example.json app-config.local.json
npm run dev
```

Open `http://127.0.0.1:5173`.

## Checks

Run these before sending a change:

```bash
npm run check
npm run client:build
```

## Repository Hygiene

- Do not commit `app-config.local.json`, `.env`, API keys, generated projects, rendered videos, or private assets.
- Do not commit proprietary fonts or third-party media unless their license allows redistribution.
- Keep generated project output under `projects/<project-id>/`.
- Keep reusable visual styles under `templates/<template-id>/`.

## Pull Requests

Please keep changes focused. For UI changes, include a short description of the workflow affected and any manual verification performed.
