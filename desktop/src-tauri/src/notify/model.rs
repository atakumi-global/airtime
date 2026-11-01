//! Pure notification model: what the webview may ask for, what gets shown, and when
//! a notification is withheld. No Tauri or Windows types here so the logic is
//! unit-testable on any host.
//!
//! Every tone carries exactly one action (success: View, warning: Open, error:
//! Restart), fixed here and not chosen by the webview, so a notification is never a
//! dead end and the webview cannot make a toast run an arbitrary action.

use serde::{Deserialize, Serialize};

/// Longest accepted notification id, title and body. Windows shows about two lines
/// of body text, so nothing useful is lost below these.
pub const MAX_ID_CHARS: usize = 64;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_BODY_CHARS: usize = 160;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Success,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Success: look at the saved entry (the timesheet).
    View,
    /// Warning: open the project that needs attention.
    Open,
    /// Error: start the timer that stopped again.
    Restart,
}

impl Action {
    pub fn id(self) -> &'static str {
        match self {
            Action::View => "view",
            Action::Open => "open",
            Action::Restart => "restart",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Action::View => "View",
            Action::Open => "Open",
            Action::Restart => "Restart",
        }
    }

    pub fn from_id(id: &str) -> Option<Action> {
        [Action::View, Action::Open, Action::Restart]
            .into_iter()
            .find(|action| action.id() == id)
    }

    /// Whether the action is about something on screen, so the window must come forward.
    /// Restart works in the background and leaves the window where it is.
    pub fn needs_window(self) -> bool {
        matches!(self, Action::View | Action::Open)
    }
}

impl Tone {
    pub fn action(self) -> Action {
        match self {
            Tone::Success => Action::View,
            Tone::Warning => Action::Open,
            Tone::Error => Action::Restart,
        }
    }

    /// A routine success is silent; warnings and errors use the system sound.
    pub fn silent(self) -> bool {
        matches!(self, Tone::Success)
    }
}

/// What the webview sends. All text is data from the webview and is bounded.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct NotificationRequest {
    /// Echoed back with the action so the webview can find the context it kept.
    pub id: String,
    pub tone: Tone,
    pub title: String,
    #[serde(default)]
    pub body: String,
}

/// A request that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notification {
    pub id: String,
    pub tone: Tone,
    pub title: String,
    pub body: String,
}

impl Notification {
    pub fn action(&self) -> Action {
        self.tone.action()
    }
}

/// Replace control characters with spaces, trim and cut to `limit` characters.
pub fn clean(value: &str, limit: usize) -> String {
    let flat: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let trimmed = flat.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(limit.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

impl NotificationRequest {
    pub fn validate(self) -> Result<Notification, String> {
        let id = clean(&self.id, MAX_ID_CHARS);
        if id.is_empty() {
            return Err("notification id is empty".to_string());
        }
        let title = clean(&self.title, MAX_TITLE_CHARS);
        if title.is_empty() {
            return Err("notification title is empty".to_string());
        }
        Ok(Notification {
            id,
            tone: self.tone,
            title,
            body: clean(&self.body, MAX_BODY_CHARS),
        })
    }
}

/// What the main window shows right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowState {
    pub visible: bool,
    pub minimized: bool,
    pub focused: bool,
}

impl WindowState {
    /// The user is looking at Airtime, so the in-app banner already says it.
    pub fn in_view(self) -> bool {
        self.visible && !self.minimized && self.focused
    }
}

/// The Windows notification state (`SHQueryUserNotificationState`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserState {
    /// Notifications may appear.
    Accepts,
    /// Focus Assist (quiet time) is on.
    FocusAssist,
    /// A full-screen app, a presentation or a game is in front.
    Occupied,
}

/// Map the `QUERY_USER_NOTIFICATION_STATE` value. An unknown value lets
/// Windows decide, so it counts as accepting.
pub fn user_state_from_code(code: i32) -> UserState {
    match code {
        // QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE, QUNS_APP
        2 | 3 | 4 | 7 => UserState::Occupied,
        // QUNS_QUIET_TIME
        6 => UserState::FocusAssist,
        // QUNS_NOT_PRESENT (locked or screen saver, the toast waits in the Action
        // Center), QUNS_ACCEPTS_NOTIFICATIONS and anything unknown.
        _ => UserState::Accepts,
    }
}

/// How a request ended; returned to the webview.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Delivery {
    Shown,
    /// Withheld: the window is in view, so it is already visible.
    WindowInView,
    /// Withheld: Focus Assist is on or a full-screen app is in front.
    FocusAssist,
    /// This platform cannot raise desktop notifications.
    Unsupported,
}

/// Decide whether to raise a notification. The window check comes first: something
/// already visible is never raised, whatever the Focus Assist state.
pub fn verdict(window: WindowState, user: UserState) -> Delivery {
    if window.in_view() {
        return Delivery::WindowInView;
    }
    match user {
        UserState::Accepts => Delivery::Shown,
        UserState::FocusAssist | UserState::Occupied => Delivery::FocusAssist,
    }
}

/// Event the webview listens to when a notification is clicked.
pub const ACTION_EVENT: &str = "notification-action";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ActionEvent {
    pub id: String,
    pub action: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tone: Tone) -> NotificationRequest {
        NotificationRequest {
            id: "n-1".into(),
            tone,
            title: "Entry saved".into(),
            body: "1h 30m on AV-142".into(),
        }
    }

    const IN_VIEW: WindowState = WindowState {
        visible: true,
        minimized: false,
        focused: true,
    };

    const HIDDEN: WindowState = WindowState {
        visible: false,
        minimized: false,
        focused: false,
    };

    #[test]
    fn every_tone_has_its_own_action() {
        assert_eq!(Tone::Success.action(), Action::View);
        assert_eq!(Tone::Warning.action(), Action::Open);
        assert_eq!(Tone::Error.action(), Action::Restart);
        assert_eq!(Action::View.label(), "View");
        assert_eq!(Action::Open.label(), "Open");
        assert_eq!(Action::Restart.label(), "Restart");
    }

    #[test]
    fn action_ids_round_trip_and_unknown_ids_are_refused() {
        for action in [Action::View, Action::Open, Action::Restart] {
            assert_eq!(Action::from_id(action.id()), Some(action));
        }
        assert_eq!(Action::from_id(""), None);
        assert_eq!(Action::from_id("quit"), None);
        assert_eq!(Action::from_id("View"), None);
    }

    #[test]
    fn only_view_and_open_bring_the_window_forward() {
        assert!(Action::View.needs_window());
        assert!(Action::Open.needs_window());
        assert!(!Action::Restart.needs_window());
    }

    #[test]
    fn only_a_routine_success_is_silent() {
        assert!(Tone::Success.silent());
        assert!(!Tone::Warning.silent());
        assert!(!Tone::Error.silent());
    }

    #[test]
    fn a_valid_request_keeps_its_text() {
        let notification = request(Tone::Success).validate().expect("valid");
        assert_eq!(notification.id, "n-1");
        assert_eq!(notification.title, "Entry saved");
        assert_eq!(notification.body, "1h 30m on AV-142");
        assert_eq!(notification.action(), Action::View);
    }

    #[test]
    fn an_empty_id_or_title_is_refused() {
        let mut no_id = request(Tone::Error);
        no_id.id = "  \n ".into();
        assert!(no_id.validate().is_err());
        let mut no_title = request(Tone::Error);
        no_title.title = "\t".into();
        assert!(no_title.validate().is_err());
    }

    #[test]
    fn an_empty_body_is_allowed() {
        let mut bare = request(Tone::Warning);
        bare.body = String::new();
        assert_eq!(bare.validate().expect("valid").body, "");
    }

    #[test]
    fn text_is_flattened_and_bounded() {
        let mut long = request(Tone::Warning);
        long.title = "a\nb\u{0}c".into();
        long.body = "x".repeat(MAX_BODY_CHARS + 50);
        long.id = "i".repeat(MAX_ID_CHARS + 10);
        let notification = long.validate().expect("valid");
        assert_eq!(notification.title, "a b c");
        assert_eq!(notification.body.chars().count(), MAX_BODY_CHARS);
        assert!(notification.body.ends_with('\u{2026}'));
        assert_eq!(notification.id.chars().count(), MAX_ID_CHARS);
    }

    #[test]
    fn tone_is_parsed_from_lowercase_json_only() {
        let parsed: NotificationRequest =
            serde_json::from_str(r#"{"id":"1","tone":"error","title":"t"}"#).expect("parse");
        assert_eq!(parsed.tone, Tone::Error);
        assert_eq!(parsed.body, "");
        assert!(
            serde_json::from_str::<NotificationRequest>(r#"{"id":"1","tone":"loud","title":"t"}"#)
                .is_err()
        );
    }

    #[test]
    fn a_window_in_view_is_never_notified() {
        assert_eq!(verdict(IN_VIEW, UserState::Accepts), Delivery::WindowInView);
        assert_eq!(verdict(IN_VIEW, UserState::FocusAssist), Delivery::WindowInView);
    }

    #[test]
    fn a_hidden_minimised_or_unfocused_window_is_notified() {
        assert_eq!(verdict(HIDDEN, UserState::Accepts), Delivery::Shown);
        let minimized = WindowState {
            visible: true,
            minimized: true,
            focused: false,
        };
        assert_eq!(verdict(minimized, UserState::Accepts), Delivery::Shown);
        let behind = WindowState {
            visible: true,
            minimized: false,
            focused: false,
        };
        assert_eq!(verdict(behind, UserState::Accepts), Delivery::Shown);
    }

    #[test]
    fn focus_assist_and_full_screen_withhold_the_notification() {
        assert_eq!(verdict(HIDDEN, UserState::FocusAssist), Delivery::FocusAssist);
        assert_eq!(verdict(HIDDEN, UserState::Occupied), Delivery::FocusAssist);
    }

    #[test]
    fn windows_notification_states_map_as_documented() {
        assert_eq!(user_state_from_code(5), UserState::Accepts);
        assert_eq!(user_state_from_code(1), UserState::Accepts);
        assert_eq!(user_state_from_code(6), UserState::FocusAssist);
        for code in [2, 3, 4, 7] {
            assert_eq!(user_state_from_code(code), UserState::Occupied, "code {code}");
        }
        assert_eq!(user_state_from_code(0), UserState::Accepts);
        assert_eq!(user_state_from_code(99), UserState::Accepts);
        assert_eq!(user_state_from_code(-1), UserState::Accepts);
    }

    #[test]
    fn delivery_serialises_in_kebab_case() {
        let json = |delivery| serde_json::to_string(&delivery).expect("serialise");
        assert_eq!(json(Delivery::Shown), "\"shown\"");
        assert_eq!(json(Delivery::WindowInView), "\"window-in-view\"");
        assert_eq!(json(Delivery::FocusAssist), "\"focus-assist\"");
        assert_eq!(json(Delivery::Unsupported), "\"unsupported\"");
    }
}
