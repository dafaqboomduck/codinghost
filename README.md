# CodingHost

Python practice plans written by Claude, solved in an in-browser editor with real test runs. It runs as a published claude.ai artifact; there is no server.

- Spec: [spec/codinghost-spec.md](spec/codinghost-spec.md)
- App: `app/codinghost.html` (single file, capabilities `sample`, `db`, `user`)
- Phase 0 smoke test: `smoke/pyodide-smoke.html`

## Setup

```sh
npm install            # playwright-core, for the e2e test only
npm run vendor         # downloads Pyodide 0.26.4 core files into app/pyodide/
```

The artifact sandbox blocks runtime fetches from CDNs, so the Pyodide files are published next to the page. Artifacts do not serve `.zip`, so the vendor script also writes `python_stdlib.zip.b64.txt`, which the page decodes at load time.

## Develop

```sh
npm run serve          # http://localhost:8765/codinghost.html?dev
```

`?dev` (only outside claude.ai) swaps in a local stand-in for Claude, the database and the user. Claude's replies come from `app/dev/sample-plan.json` and data goes to `localStorage`.

## Test

```sh
npm test               # Python harness unit tests (Pyodide under Node)
npm run e2e            # full browser run in dev mode; set CHROMIUM_PATH if needed
```

## Publish

Publish `app/codinghost.html` as an artifact with capabilities `{sample: {}, db: {}, user: {}}`, plus these files under `pyodide/`: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip.b64.txt` and `pyodide-lock.json`. Do not publish `python_stdlib.zip` or `app/dev/`.
