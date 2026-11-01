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
| Toast notifications with action buttons | Supported through `tauri-winrt-notification` (see AIRTIME-36 below); the `tauri-plugin-notification` plugin was not used so the shell decides when to withhold a toast and handles the click itself, with no extra webview permission | Compiles for Windows; not run | n/a |

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

## Shell: desktop notifications with actions (AIRTIME-36)

Three notifications mirror the in-app feedback, each with exactly one action
(v2 `shell.html`, Notifications):

| Tone | Raised when | Text | Action |
| --- | --- | --- | --- |
| Success | Stopping the timer creates an entry | "Entry saved", "1h 30m on AV-142" | **View** opens My time |
| Warning | A project's margin falls from on target to below target | "Margin below target", "Aviation Ops is EUR 1,200 under target" | **Open** opens Projects |
| Error | The timer disappears and this app did not stop it | "Timer stopped unexpectedly", "Was tracking AV-142. Restart to keep going." | **Restart** starts that work item again |

- **Where it lives.** `src/components/NotificationBridge.tsx` watches the app
  state and asks for a notification through `src/lib/notifications.ts` (pure
  builders, tested) and the `notify` command. `src-tauri/src/notify/model.rs`
  is the pure decision model (tone to action, validation, when to withhold);
  `notify/mod.rs` is the Windows glue (`tauri-winrt-notification`, the Tauri
  project's WinRT toast wrapper). The action of a tone is fixed
  in Rust, so the webview cannot attach another one. Clicking the toast, or its
  button, sends `notification-action` back to the webview; View and Open also
  bring the window forward, Restart does not.
- **Never for something already visible.** The shell withholds a notification
  while the main window is visible, not minimised and focused. The in-app banner
  remains the message then. Closed to the tray, minimised or behind another
  window counts as out of view.
- **Focus Assist.** Before raising a toast the shell asks Windows
  (`SHQueryUserNotificationState`). Quiet hours / Focus Assist, a full-screen
  app, a presentation or a game withhold the toast (`focus-assist` delivery);
  nothing is queued, so nothing appears later out of context. A routine success
  is also silent (no sound); warnings and errors use the system sound.
- **Reduced motion.** The app draws no notification of its own and adds no
  animation: the toast is a native Windows toast, so its slide-in follows the
  Windows setting Accessibility, Visual effects, Animation effects. Nothing in
  the web UI animates for notifications.
- **Not raised on purpose.** The first load after boot or sign-in (state comes
  from the on-device cache, so changes since are not news); a start that fails
  and drops its optimistic timer; a stop that fails offline and is queued; an
  entry that arrives from elsewhere in a refresh.
- **Identity.** A packaged (release) build uses the app identifier
  `com.atakumi.airtime` as the toast's AppUserModelID; a `tauri dev` build is
  not installed, so it borrows the PowerShell identity (the wrapper's documented fallback).
  Whether the NSIS installer registers that identifier with the Start menu
  shortcut so toasts show the Airtime name and icon in a release build is not
  verified here.

Verified on Linux: the notify module compiles for `x86_64-pc-windows-gnu`; the
pure model passes 14 Rust unit tests in a standalone harness (the crate cannot
link without GTK/WebKit); the web side passes lint, tests and build. Not
verified (no Windows host): a toast actually appearing, its button and body
click, Focus Assist and full-screen suppression, and the sound.
