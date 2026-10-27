# Protected behaviours

**RULE (read before any change).** If a task would change any behaviour listed
below, STOP on that item, change nothing, and report which line it conflicts
with. Only a prompt that names the line and says `change protected: <line>` may
change it, and the same commit must update this file AND its contract test.

Each line records what the behaviour does, the commit or spec that decided it,
and where it lives (`file:line`). Values are recorded as the CODE has them now;
a `[from commit <sha>]` or `[from spec <id>]` tag names the evidence. Trust the
named symbol over the exact line number if the file has since shifted.

Contract tests for these lines live in `src/contracts/__tests__/`.

---

## Data loading and integrity

- **P-01** The data loader verifies a file's SHA-256 against the manifest BEFORE
  any store write, and never stores unverified bytes; a mismatch, non-2xx,
  network error, or parse error retains the previously stored data.
  `fetchAndVerify`/`loadFile`, `src/data/loader.ts`. [from part P1]
- **P-02** The host returns index.html with HTTP 200 for a missing file, so a
  200 is never treated as proof a file exists: the manifest shape check and the
  SHA-256 verification are the only gates. `isManifest`, `src/data/manifest.ts`;
  SPA-200 `cacheWillUpdate` guard, `vite.config.ts`. [from part P1]
- **P-03** The manifest URL is origin-absolute (`/data/manifest.json`) and data
  files are fetched with an origin-absolute base (`/data/`) and `?h=<sha256>`,
  so a deep-link document path never makes them resolve to the SPA fallback.
  `MANIFEST_URL`, `src/data/manifest.ts`; `dataUrl`, `src/data/loader.ts`.
  [from part P1]

## Language

- **P-04** Interface language resolves `?lang=km|en` → cookie `lang_84000` →
  default `km`; an explicit `?lang=` is persisted; `<html lang>` and `<html
  data-lang>` are set on load; all cookie access is wrapped in try/catch so a
  blocked cookie store never throws. `resolveLang`/`writeLangCookie`/`applyLang`,
  `src/lang.ts`. [from part P1]
- **P-05** The `lang_84000` cookie uses Domain `.84000.digital` only on an
  84000.digital host (omitted on workers.dev/localhost), Path=/, Max-Age one
  year, SameSite=Lax, and Secure only on https. `writeLangCookie`,
  `src/lang.ts`. [from part P1]

## Reliable updates

- **P-06** The service worker is `registerType: 'prompt'`: the version switch is
  never silent — the user accepts the prompt, then the app reloads once the new
  SW takes control (one-time `controllerchange`). Update is re-checked on
  register, hourly, and on foreground. `registerServiceWorker`, `src/main.ts`;
  `cacheId: learn-<hash>`, `vite.config.ts`. [from part P1]

<!-- P4 appends one P-line per screen behaviour it builds (see part P4). -->
