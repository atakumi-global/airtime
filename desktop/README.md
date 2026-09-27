# Airtime desktop

Windows desktop client for Airtime: Tauri v2 with React and TypeScript. The UI
is ported from the coded designs in `../design/AIRTIME-16/v2`.

```powershell
npm install
npm run tauri dev      # development window with hot reload
npm run tauri build    # NSIS installer
npm test               # unit tests
npm run build          # type check plus production web bundle
npm run lint
```

Requirements: Node 20+, Rust with the MSVC toolchain, WebView2 (present on
Windows 10/11). The app talks to the Airtime server at the URL entered on the
sign-in screen, default `http://localhost:3000`.

What lives where:

- `src/lib` - API client, formatting, Tauri bridge (Credential Manager and the
  on-disk cache; browser fallbacks so the UI can run in a plain browser during
  development).
- `src/state` - application state: session, cache-first boot, offline queue,
  timer.
- `src/components` - shell, timer bar, back-fill dialog, primitives.
- `src/screens` - Login, My time, Projects, Settings.
- `src-tauri` - Rust commands for secrets and cache, window configuration.

Two Windows gotchas are already handled, both of which produce a misleading
"network unreachable" on sign-in:

- The WebView2 may not connect to loopback from an unpackaged app, so all API
  calls go through `tauri-plugin-http` (reqwest in the host process) rather than
  the webview `fetch`.
- The HTTP plugin requires scoped permissions for each command it uses:
  `http:allow-fetch`, `http:allow-fetch-send` and `http:allow-fetch-read-body`
  in `src-tauri/capabilities/default.json`, with the URL patterns allowed. A
  missing one reads as "url not allowed on the configured scope".
