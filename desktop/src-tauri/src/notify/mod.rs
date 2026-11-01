//! Desktop notifications with actions: success, warning and error toasts that carry
//! one action each (View, Open, Restart).
//!
//! The webview decides *what* happened and asks through `notify`; this module decides
//! *whether* to raise it. A notification is withheld when the window is in view (it
//! would repeat what is on screen) and when Windows Focus Assist or a full-screen app
//! asks for quiet; the in-app banner still carries the message then. Clicking the toast
//! brings the window forward where the action needs it and sends the choice back as the
//! `notification-action` event. `model` is pure and unit-tested; this file is the glue.

pub mod model;

use tauri::{AppHandle, Manager};

use model::{Delivery, NotificationRequest, WindowState};

fn window_state(app: &AppHandle) -> WindowState {
    let Some(window) = app.get_webview_window(crate::tray::MAIN_WINDOW) else {
        return WindowState {
            visible: false,
            minimized: false,
            focused: false,
        };
    };
    WindowState {
        visible: window.is_visible().unwrap_or(false),
        minimized: window.is_minimized().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
    }
}

#[cfg(windows)]
mod platform {
    use tauri::{AppHandle, Emitter};
    use tauri_winrt_notification::{Sound, Toast};

    use super::model::{self, Action, ActionEvent, Notification, UserState};

    // `QUERY_USER_NOTIFICATION_STATE`: Focus Assist, presentations and full-screen apps.
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHQueryUserNotificationState(state: *mut i32) -> i32;
    }

    pub fn user_state() -> UserState {
        let mut code: i32 = 0;
        // SAFETY: `code` is a valid, writable i32 for the duration of the call.
        let result = unsafe { SHQueryUserNotificationState(&mut code) };
        if result < 0 {
            // Cannot tell: let Windows apply its own rules to the toast.
            return UserState::Accepts;
        }
        model::user_state_from_code(code)
    }

    /// An installed build uses the app identifier, which the installer registers as the
    /// shortcut's AppUserModelID. A development build is not installed, so it borrows
    /// the PowerShell identity, the same way the Tauri notification plugin does.
    fn app_id(app: &AppHandle) -> String {
        if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID.to_string()
        } else {
            app.config().identifier.clone()
        }
    }

    pub fn show(app: &AppHandle, notification: Notification) -> Result<(), String> {
        let action = notification.action();
        let handle = app.clone();
        let id = notification.id.clone();
        let sound = if notification.tone.silent() {
            None
        } else {
            Some(Sound::Default)
        };

        Toast::new(&app_id(app))
            .title(&notification.title)
            .text1(&notification.body)
            .sound(sound)
            .add_button(action.label(), action.id())
            .on_activated(move |argument| {
                // A button click carries its action id; a click on the toast itself
                // carries none and means the toast's own action.
                let (chosen, body_click) = match argument.as_deref() {
                    Some(value) => match Action::from_id(value) {
                        Some(chosen) if chosen == action => (chosen, false),
                        _ => return Ok(()),
                    },
                    None => (action, true),
                };
                if body_click || chosen.needs_window() {
                    crate::tray::show_main_window(&handle);
                }
                let event = ActionEvent {
                    id: id.clone(),
                    action: chosen.id(),
                };
                if let Err(error) = handle.emit_to(crate::tray::MAIN_WINDOW, model::ACTION_EVENT, event)
                {
                    log::warn!("notify: could not deliver action {}: {error}", chosen.id());
                }
                Ok(())
            })
            .show()
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;

    use super::model::{Notification, UserState};

    pub fn user_state() -> UserState {
        UserState::Accepts
    }

    pub fn show(_app: &AppHandle, _notification: Notification) -> Result<(), String> {
        Err("desktop notifications are only available on Windows".to_string())
    }
}

/// Raise a notification unless it would repeat what is on screen or Windows asks for quiet.
pub fn raise(app: &AppHandle, request: NotificationRequest) -> Result<Delivery, String> {
    let notification = request.validate()?;
    let verdict = model::verdict(window_state(app), platform::user_state());
    if verdict != Delivery::Shown {
        return Ok(verdict);
    }
    if !cfg!(windows) {
        return Ok(Delivery::Unsupported);
    }
    platform::show(app, notification)?;
    Ok(Delivery::Shown)
}

#[tauri::command]
pub async fn notify(app: AppHandle, request: NotificationRequest) -> Result<Delivery, String> {
    raise(&app, request)
}
