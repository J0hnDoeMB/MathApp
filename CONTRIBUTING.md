# Contributing

MathApp is a local-first app with a stable core and optional feature modules. Small, tested changes are preferred over broad rewrites.

## Setup

```bash
npm start                 # Node 18+
npm test                  # 80 Node checks
npm run test:ui           # browser smoke (puppeteer-core + Edge/Chrome)
npm run test:geo          # GeoGebra smoke (CDN)
npm run test:py           # optional Python/SymPy tests
npm run eval              # 17 deterministic math cases
npm run check:docs        # local Markdown links and stale test paths
```

The portable core (Node tests, eval, Python tests) runs on Linux in CI. Windows adds the PowerShell launcher and browser/GeoGebra smokes.

## Pull requests

- Keep the core (`chat`, sessions, algebra, GeoGebra) stable; put optional behavior behind the core/full gate.
- Add a focused test for behavior changes and update the relevant contract/doc.
- Do not commit `settings.json`, `data/`, `backups/`, `logs/`, `.venv/`, API keys or personal absolute paths.
- Update `CHANGELOG.md` for user-visible changes.
- Run `npm test`, `npm run check:docs` and, when relevant, UI/GeoGebra/Python checks before opening the PR.
- Do not weaken auth, CSRF, path confinement or the SymPy AST whitelist without a security review.

## Releases

Update the version in `package.json`, add a `CHANGELOG.md` entry, tag `vX.Y.Z`, and publish release notes. The `tests` check must be green on `main`; branch protection applies to pull requests.
