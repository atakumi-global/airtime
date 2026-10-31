# Airtime desktop

Windows desktop client for Airtime: Tauri v2 with React and TypeScript. The UI
is ported from the coded designs in `../prototypes/AIRTIME-16/v2`.

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
- `src/screens` - Login, My time, Projects, Budgets, Reports, Admin, Settings.
- `src-tauri` - Rust commands for secrets and cache, window configuration.
- `src-tauri/src/tray` - system tray (AIRTIME-35): `model.rs` (state and menu,
  pure), `icon.rs` (the four state icons drawn in code, pure), `mod.rs` (Tauri
  glue). AIRTIME-36 and 37 add their own modules next to it.

Two Windows gotchas are already handled, both of which produce a misleading
"network unreachable" on sign-in:

- The WebView2 may not connect to loopback from an unpackaged app, so all API
  calls go through `tauri-plugin-http` (reqwest in the host process) rather than
  the webview `fetch`.
- The HTTP plugin requires scoped permissions for each command it uses:
  `http:allow-fetch`, `http:allow-fetch-send` and `http:allow-fetch-read-body`
  in `src-tauri/capabilities/default.json`, with the URL patterns allowed. A
  missing one reads as "url not allowed on the configured scope".

## Shell: system tray and window chrome (AIRTIME-35)

- The window is frameless (`decorations: false`). `src/components/TitleBar.tsx`
  is the 36px title bar from the v2 shell: drag region (`data-tauri-drag-region`),
  live mini-timer while a timer runs or is paused, and Minimise / Maximise /
  Close. It only renders inside Tauri; the browser preview keeps no title bar.
- **Close hides to the tray; Quit lives in the tray menu.** The close request is
  intercepted in `tray::on_window_event`, and only once the tray icon exists, so
  the window can never be hidden with no way back.
- The tray mirrors the timer bar. The webview reports state with the
  `set_tray_state` command (`src/components/TrayBridge.tsx`, payload built by the
  pure `src/lib/trayState.ts`); menu choices return as the `tray-action` event.
  The tray advances the running clock itself once a second because a hidden
  webview is throttled.
- Four states, each with its own glyph so state never relies on colour alone:
  idle = ring, running = play triangle, paused = two bars, error/offline =
  exclamation mark. Left click shows the window; right click opens the menu.
- Menu: status line, one primary action per state (Start last work item /
  Pause + Stop / Resume + Stop / Retry sync), then Open Airtime, Back-fill time,
  Timesheet, Settings and Quit Airtime.

### Tauri v2 Windows capability matrix

Checked against the sources of the pinned crates (tauri 2.12.0, tray-icon 0.25.1,
tauri-utils 2.10.0) and by compiling for `x86_64-pc-windows-gnu`.

| Capability | Windows | Evidence | Verified on |
| --- | --- | --- | --- |
| Tray icon, runtime icon swap (`set_icon`) | Supported | tray-icon README lists Windows; `TrayIcon::set_icon` has no Windows caveat | Compiles for Windows; not run |
| Tray tooltip (`set_tooltip`) | Supported (Linux: unsupported) | `tray/mod.rs` platform notes | Compiles; not run |
| Tray title (`set_title`) | Unsupported on Windows, so not used | `tray/mod.rs` | n/a |
| Tray menu, in-place `set_text`, `set_menu` | Supported | muda 0.20 | Compiles; not run |
| Left-click event | Supported (Linux: no click events) | `TrayIconEvent` docs | Compiles; not run |
| Frameless window (`decorations: false`) | Supported; undecorated windows get a 1px border and Windows 11 rounded corners | `tauri-utils` window config docs | Config only; not run |
| Drag region, double-click to maximise | Supported; needs `core:window:allow-start-dragging` (set) and `allow-internal-toggle-maximize` (in `core:default`) | tauri 2.12.0 permission reference | Permission ids validated by the build script |
| Minimise / maximise / close from the webview | Supported; needs `allow-minimize`, `allow-toggle-maximize`, `allow-close` (set) | tauri 2.12.0 permission reference | Permission ids validated by the build script |
| Intercept close (`CloseRequested`, `prevent_close`) | Supported | `Window::close` docs: emits CloseRequested first | Compiles; not run |
| Notifications | Not part of this item | n/a | n/a |

Verified here (Linux sandbox): the crate type-checks for `x86_64-pc-windows-gnu`
with the `tray-icon` feature, the capability file resolves, the pure tray model
and icon code pass 12 unit tests in a standalone harness (the crate itself cannot link here), and the web side passes lint,
tests and build.

Not verified (no Windows host, no GTK/WebKit libraries on this Linux box, so the
app cannot be linked or launched): the tray icon actually appearing and
updating in the Windows notification area, the menu rendering, close-to-tray
and restore from the tray on a real window, drag and resize behaviour of the
frameless window (including the Windows 11 border), WebView2 timer throttling
while hidden, and high-DPI icon sharpness (the icon is drawn at 32x32). These
need one manual pass on Windows with `npm run tauri dev`; the checklist is in
HANDOVER.md.
