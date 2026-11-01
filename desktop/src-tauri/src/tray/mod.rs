//! System tray: icon per timer state, state-aware menu and close-to-tray support.
//!
//! The webview reports timer state through `set_tray_state`; the tray never owns
//! timer logic. Menu choices travel back to the webview as the `tray-action` event.
//! `model` and `icon` are pure and unit-tested; this file is the Tauri glue.
//!
//! Locking: only background threads (the clock thread and async commands) take the
//! locks below. The main thread (menu, tray and window events) never does, so a lock
//! holder may safely wait for the main thread inside a tray call.

pub mod icon;
pub mod model;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};

use model::{MenuEntry, TrayPayload, TrayStatus};

const TRAY_ID: &str = "airtime-tray";
pub const MAIN_WINDOW: &str = "main";
/// Event the webview listens to; the payload is the menu item id.
pub const ACTION_EVENT: &str = "tray-action";

struct Shown {
    entries: Vec<MenuEntry>,
    items: HashMap<&'static str, MenuItem<Wry>>,
    status: Option<TrayStatus>,
}

pub struct TrayState {
    payload: Mutex<TrayPayload>,
    shown: Mutex<Shown>,
    /// True once the tray icon exists; close-to-tray is only safe then, because a
    /// hidden window with no tray icon could never be brought back.
    ready: AtomicBool,
}

impl TrayState {
    pub fn new() -> Self {
        TrayState {
            payload: Mutex::new(TrayPayload {
                status: TrayStatus::Idle,
                headline: "Sign in to start tracking".to_string(),
                detail: String::new(),
                elapsed_seconds: None,
                clock_running: false,
                has_timer: false,
                can_start: false,
            }),
            shown: Mutex::new(Shown {
                entries: Vec::new(),
                items: HashMap::new(),
                status: None,
            }),
            ready: AtomicBool::new(false),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn icon_for(status: TrayStatus) -> Image<'static> {
    Image::new_owned(
        icon::render(status, icon::ICON_SIZE),
        icon::ICON_SIZE,
        icon::ICON_SIZE,
    )
}

fn build_menu(
    app: &AppHandle,
    entries: &[MenuEntry],
) -> tauri::Result<(Menu<Wry>, HashMap<&'static str, MenuItem<Wry>>)> {
    let menu = Menu::new(app)?;
    let mut items = HashMap::new();
    for entry in entries {
        match entry {
            MenuEntry::Item { id, text, enabled } => {
                let item = MenuItem::with_id(app, *id, text, *enabled, None::<&str>)?;
                menu.append(&item)?;
                items.insert(*id, item);
            }
            MenuEntry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok((menu, items))
}

/// Bring the main window in front of the user.
pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("tray: main window not found");
        return;
    };
    if let Err(error) = window.show() {
        log::warn!("tray: could not show the window: {error}");
    }
    if let Err(error) = window.unminimize() {
        log::warn!("tray: could not restore the window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("tray: could not focus the window: {error}");
    }
}

fn handle_menu_action(app: &AppHandle, id: &str) {
    if id == model::ID_QUIT {
        app.exit(0);
        return;
    }
    if !model::is_known_action(id) {
        return;
    }
    if model::needs_window(id) {
        show_main_window(app);
    }
    if let Err(error) = app.emit_to(MAIN_WINDOW, ACTION_EVENT, id) {
        log::warn!("tray: could not deliver action {id}: {error}");
    }
}

fn create_tray(
    app: &AppHandle,
    payload: &TrayPayload,
    entries: &[MenuEntry],
    shown: &mut Shown,
) -> tauri::Result<()> {
    let (menu, items) = build_menu(app, entries)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_for(payload.status))
        .tooltip(payload.tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_action(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    shown.entries = entries.to_vec();
    shown.items = items;
    shown.status = Some(payload.status);
    Ok(())
}

/// Make the tray icon, tooltip and menu match the stored payload.
fn sync(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let payload = lock(&state.payload).clone();
    let entries = payload.menu();
    let mut shown = lock(&state.shown);

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        create_tray(app, &payload, &entries, &mut shown).map_err(|error| error.to_string())?;
        state.ready.store(true, Ordering::SeqCst);
        return Ok(());
    };

    if shown.status != Some(payload.status) {
        tray.set_icon(Some(icon_for(payload.status)))
            .map_err(|error| error.to_string())?;
        shown.status = Some(payload.status);
    }
    tray.set_tooltip(Some(payload.tooltip()))
        .map_err(|error| error.to_string())?;

    if model::same_structure(&shown.entries, &entries) {
        for entry in &entries {
            if let MenuEntry::Item { id, text, .. } = entry
                && let Some(item) = shown.items.get(id)
            {
                item.set_text(text).map_err(|error| error.to_string())?;
            }
        }
    } else {
        let (menu, items) = build_menu(app, &entries).map_err(|error| error.to_string())?;
        tray.set_menu(Some(menu)).map_err(|error| error.to_string())?;
        shown.items = items;
    }
    shown.entries = entries;
    Ok(())
}

/// Store the state reported by the webview and refresh the tray.
pub fn update(app: &AppHandle, payload: TrayPayload) -> Result<(), String> {
    *lock(&app.state::<TrayState>().payload) = payload.sanitised();
    sync(app)
}

/// Build the tray and keep its clock moving once a second while a timer counts.
/// Runs on its own thread so the main thread never waits on a tray lock.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("tray-clock".to_string())
        .spawn(move || {
            if let Err(error) = sync(&app) {
                log::error!("tray: could not create the tray icon: {error}");
            }
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let advanced = {
                    let state = app.state::<TrayState>();
                    let mut payload = lock(&state.payload);
                    if payload.clock_running {
                        *payload = payload.advanced(1);
                        true
                    } else {
                        false
                    }
                };
                if advanced && let Err(error) = sync(&app) {
                    log::warn!("tray: could not refresh the clock: {error}");
                }
            }
        });
    if let Err(error) = spawned {
        log::error!("tray: could not start the tray thread: {error}");
    }
}

/// Close hides to the tray while the tray exists; Quit lives in the tray menu.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && window.label() == MAIN_WINDOW
        && window.app_handle().state::<TrayState>().ready.load(Ordering::SeqCst)
    {
        api.prevent_close();
        if let Err(error) = window.hide() {
            log::warn!("tray: could not hide the window: {error}");
        }
    }
}

#[tauri::command]
pub async fn set_tray_state(app: AppHandle, payload: TrayPayload) -> Result<(), String> {
    update(&app, payload)
}
