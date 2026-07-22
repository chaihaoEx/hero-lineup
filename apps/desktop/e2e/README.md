# Desktop E2E coverage

Run with `npm run test:e2e` from the repository root. Playwright starts the
Vite browser preview on `127.0.0.1:1420`, blocks every non-loopback HTTP(S)
request, and retains traces/screenshots/video on failure.

## What this suite proves

- System create, save, reload, duplicate, and delete through the local-storage
  browser adapter.
- Hero and champion loadout editing.
- The application drag/drop payload contract for adding a hero to a task.
- Visible progress and results for both 1,000 and 10,000 preview simulations.
- Basic rendering at 1440×900, 1280×800, 1024×768, and 390×844.
- No remote runtime requests or remote DOM resource URLs during these flows.
- The WebView-side Tauri IPC command/argument flow for `.zyslineup` export and
  import, using an explicit in-page contract mock.

## Native boundary (not proved by this suite)

The ordinary Vite preview intentionally rejects canonical `.zyslineup`
import/export. A separate contract-mock test proves that the UI invokes the
expected Tauri commands and consumes their responses, but it does not execute
the Rust backend. Browser E2E does not expose real Tauri file dialogs, SQLite,
`.zysbackup`, checksum validation,
atomic file writes, the Rust simulator, packaged-resource resolution, or the
`.zysdata` installer. The E2E test verifies that import/export UI reaches this
explicit boundary; those native behaviours require Rust integration tests and a
packaged-app smoke test. The simulated drag uses the same browser `DataTransfer`
payload as a real card because source cards and task cards live on different
tabs and therefore cannot be pointer-dragged simultaneously.

At 390px the current stylesheet retains a 760px minimum application width. The
suite proves that the narrow viewport still renders and exposes core controls,
and records the resulting horizontal overflow as a Playwright annotation; it
does not claim a reflowed mobile layout.
