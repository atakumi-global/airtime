//! Pure tray model: the state the webview reports and the menu derived from it.
//! No Tauri types here so the logic is unit-testable on any host.

use serde::Deserialize;

pub const ID_OPEN: &str = "open";
pub const ID_STATUS: &str = "status";
pub const ID_DETAIL: &str = "detail";
pub const ID_START_LAST: &str = "start-last";
pub const ID_PAUSE: &str = "pause";
pub const ID_RESUME: &str = "resume";
pub const ID_STOP: &str = "stop";
pub const ID_RETRY: &str = "retry";
pub const ID_BACKFILL: &str = "backfill";
pub const ID_TIMESHEET: &str = "timesheet";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT: &str = "quit";

/// Longest text accepted from the webview for any tray label. Windows truncates
/// tooltips at 127 UTF-16 units, so nothing useful is lost below this.
pub const MAX_TEXT_CHARS: usize = 100;
pub const MAX_TOOLTIP_CHARS: usize = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayStatus {
    Idle,
    Running,
    Paused,
    Error,
}

impl TrayStatus {
    pub fn label(self) -> &'static str {
        match self {
            TrayStatus::Idle => "Idle",
            TrayStatus::Running => "Running",
            TrayStatus::Paused => "Paused",
            TrayStatus::Error => "Offline",
        }
    }
}

/// What the webview reports; it mirrors the timer bar.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPayload {
    pub status: TrayStatus,
    /// Work item or headline, for example "AV-142 Pre-flight checklist".
    pub headline: String,
    /// Second line, for example "2 entries queued".
    #[serde(default)]
    pub detail: String,
    /// Active seconds on the timer at the moment of the report, if there is one.
    #[serde(default)]
    pub elapsed_seconds: Option<u64>,
    /// The clock is counting, so the tray advances it itself. The webview is
    /// throttled while its window is hidden and must not be relied on to tick.
    #[serde(default)]
    pub clock_running: bool,
    /// A timer exists (running or paused), so Stop is always offered.
    #[serde(default)]
    pub has_timer: bool,
    /// A timer can be started from the tray.
    #[serde(default)]
    pub can_start: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MenuEntry {
    Item {
        id: &'static str,
        text: String,
        enabled: bool,
    },
    Separator,
}

fn clean(value: &str, limit: usize) -> String {
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

/// A `&` in menu text is a mnemonic marker; text from the webview is data, so escape it.
fn menu_text(value: &str) -> String {
    value.replace('&', "&&")
}

/// `HH:MM:SS`, the same shape as the timer bar.
pub fn format_clock(seconds: u64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

impl TrayPayload {
    /// Bound lengths and strip control characters: the payload comes from the webview.
    pub fn sanitised(mut self) -> Self {
        self.headline = clean(&self.headline, MAX_TEXT_CHARS);
        self.detail = clean(&self.detail, MAX_TEXT_CHARS);
        self
    }

    /// The same report `seconds` later; only a counting clock moves.
    pub fn advanced(&self, seconds: u64) -> Self {
        let mut next = self.clone();
        if self.clock_running {
            next.elapsed_seconds = self.elapsed_seconds.map(|value| value.saturating_add(seconds));
        }
        next
    }

    fn elapsed(&self) -> Option<String> {
        self.elapsed_seconds.map(format_clock)
    }

    pub fn tooltip(&self) -> String {
        let mut text = String::from("Airtime \u{2013} ");
        text.push_str(self.status.label());
        if let Some(elapsed) = self.elapsed() {
            text.push(' ');
            text.push_str(&elapsed);
        }
        if !self.headline.is_empty() {
            text.push_str(" \u{2013} ");
            text.push_str(&self.headline);
        }
        clean(&text, MAX_TOOLTIP_CHARS)
    }

    fn status_line(&self) -> String {
        let mut text = self.status.label().to_string();
        if let Some(elapsed) = self.elapsed() {
            text.push(' ');
            text.push_str(&elapsed);
        }
        if !self.headline.is_empty() {
            text.push_str(" \u{00b7} ");
            text.push_str(&self.headline);
        }
        menu_text(&text)
    }

    /// The menu for this state: a status header, one primary action per state,
    /// then the shared destinations and Quit.
    pub fn menu(&self) -> Vec<MenuEntry> {
        let item = |id: &'static str, text: &str, enabled: bool| MenuEntry::Item {
            id,
            text: text.to_string(),
            enabled,
        };
        let mut entries = vec![
            MenuEntry::Item {
                id: ID_STATUS,
                text: self.status_line(),
                enabled: false,
            },
        ];
        if !self.detail.is_empty() {
            entries.push(MenuEntry::Item {
                id: ID_DETAIL,
                text: menu_text(&self.detail),
                enabled: false,
            });
        }
        entries.push(MenuEntry::Separator);
        match self.status {
            TrayStatus::Idle => {
                entries.push(item(ID_START_LAST, "Start last work item", self.can_start));
            }
            TrayStatus::Running => {
                entries.push(item(ID_PAUSE, "Pause timer", true));
                entries.push(item(ID_STOP, "Stop timer", true));
            }
            TrayStatus::Paused => {
                entries.push(item(ID_RESUME, "Resume timer", true));
                entries.push(item(ID_STOP, "Stop timer", true));
            }
            TrayStatus::Error => {
                entries.push(item(ID_RETRY, "Retry sync now", true));
                if self.has_timer {
                    entries.push(item(ID_STOP, "Stop timer", true));
                } else {
                    entries.push(item(ID_START_LAST, "Start last work item", self.can_start));
                }
            }
        }
        entries.push(MenuEntry::Separator);
        entries.push(item(ID_OPEN, "Open Airtime", true));
        entries.push(item(ID_BACKFILL, "Back-fill time", true));
        entries.push(item(ID_TIMESHEET, "Timesheet", true));
        entries.push(item(ID_SETTINGS, "Settings", true));
        entries.push(MenuEntry::Separator);
        entries.push(item(ID_QUIT, "Quit Airtime", true));
        entries
    }
}

/// True when two menus differ only in the text of the live status lines, so the
/// existing menu can be updated in place instead of replaced.
pub fn same_structure(a: &[MenuEntry], b: &[MenuEntry]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|pair| match pair {
            (MenuEntry::Separator, MenuEntry::Separator) => true,
            (
                MenuEntry::Item {
                    id: id_a,
                    text: text_a,
                    enabled: enabled_a,
                },
                MenuEntry::Item {
                    id: id_b,
                    text: text_b,
                    enabled: enabled_b,
                },
            ) => {
                id_a == id_b
                    && enabled_a == enabled_b
                    && (text_a == text_b || *id_a == ID_STATUS || *id_a == ID_DETAIL)
            }
            _ => false,
        })
}

/// Actions the webview handles itself (window destinations are shown by Rust first).
pub fn is_known_action(id: &str) -> bool {
    matches!(
        id,
        ID_OPEN
            | ID_START_LAST
            | ID_PAUSE
            | ID_RESUME
            | ID_STOP
            | ID_RETRY
            | ID_BACKFILL
            | ID_TIMESHEET
            | ID_SETTINGS
    )
}

/// Actions that need the window in front of the user.
pub fn needs_window(id: &str) -> bool {
    matches!(id, ID_OPEN | ID_BACKFILL | ID_TIMESHEET | ID_SETTINGS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(status: TrayStatus) -> TrayPayload {
        TrayPayload {
            status,
            headline: "AV-142 Pre-flight checklist".into(),
            detail: String::new(),
            elapsed_seconds: None,
            clock_running: false,
            has_timer: false,
            can_start: true,
        }
    }

    fn ids(entries: &[MenuEntry]) -> Vec<&'static str> {
        entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Item { id, .. } => Some(*id),
                MenuEntry::Separator => None,
            })
            .collect()
    }

    #[test]
    fn every_state_has_its_primary_action_and_quit() {
        assert!(ids(&payload(TrayStatus::Idle).menu()).contains(&ID_START_LAST));
        let running = ids(&payload(TrayStatus::Running).menu());
        assert!(running.contains(&ID_PAUSE) && running.contains(&ID_STOP));
        let paused = ids(&payload(TrayStatus::Paused).menu());
        assert!(paused.contains(&ID_RESUME) && paused.contains(&ID_STOP));
        assert!(!paused.contains(&ID_PAUSE));
        let error = ids(&payload(TrayStatus::Error).menu());
        assert!(error.contains(&ID_RETRY));
        for status in [
            TrayStatus::Idle,
            TrayStatus::Running,
            TrayStatus::Paused,
            TrayStatus::Error,
        ] {
            let menu = ids(&payload(status).menu());
            assert_eq!(menu.last(), Some(&ID_QUIT));
            for id in [ID_BACKFILL, ID_TIMESHEET, ID_SETTINGS] {
                assert!(menu.contains(&id));
            }
        }
    }

    #[test]
    fn start_last_is_disabled_without_a_last_work_item() {
        let mut idle = payload(TrayStatus::Idle);
        idle.can_start = false;
        let found = idle.menu().into_iter().any(|entry| {
            matches!(entry, MenuEntry::Item { id: ID_START_LAST, enabled: false, .. })
        });
        assert!(found);
    }

    #[test]
    fn status_line_mirrors_state_and_clock() {
        let mut running = payload(TrayStatus::Running);
        running.elapsed_seconds = Some(5045);
        running.clock_running = true;
        match &running.menu()[0] {
            MenuEntry::Item { id, text, enabled } => {
                assert_eq!(*id, ID_STATUS);
                assert!(!enabled);
                assert_eq!(text, "Running 01:24:05 \u{00b7} AV-142 Pre-flight checklist");
            }
            MenuEntry::Separator => panic!("status line must come first"),
        }
        assert_eq!(
            running.tooltip(),
            "Airtime \u{2013} Running 01:24:05 \u{2013} AV-142 Pre-flight checklist"
        );
    }

    #[test]
    fn text_from_the_webview_is_bounded_and_escaped() {
        let hostile = TrayPayload {
            status: TrayStatus::Idle,
            headline: format!("A&B\n\u{0}{}", "x".repeat(500)),
            detail: "d".repeat(500),
            elapsed_seconds: None,
            clock_running: false,
            has_timer: false,
            can_start: false,
        }
        .sanitised();
        assert_eq!(hostile.headline.chars().count(), MAX_TEXT_CHARS);
        assert!(hostile.headline.starts_with("A&B  "));
        assert!(hostile.tooltip().chars().count() <= MAX_TOOLTIP_CHARS);
        match &hostile.menu()[0] {
            MenuEntry::Item { text, .. } => assert!(text.contains("A&&B")),
            MenuEntry::Separator => panic!("status line must come first"),
        }
    }

    #[test]
    fn a_ticking_clock_keeps_the_menu_structure() {
        let mut first = payload(TrayStatus::Running);
        first.elapsed_seconds = Some(1);
        first.clock_running = true;
        let second = first.advanced(60);
        assert_eq!(second.elapsed_seconds, Some(61));
        assert_ne!(first.menu(), second.menu());
        assert!(same_structure(&first.menu(), &second.menu()));
        assert!(!same_structure(
            &first.menu(),
            &payload(TrayStatus::Paused).menu()
        ));
    }

    #[test]
    fn a_paused_clock_does_not_advance() {
        let mut paused = payload(TrayStatus::Paused);
        paused.elapsed_seconds = Some(5045);
        assert_eq!(paused.advanced(30).elapsed_seconds, Some(5045));
        assert_eq!(format_clock(5045), "01:24:05");
        assert_eq!(format_clock(0), "00:00:00");
    }

    #[test]
    fn offline_with_a_timer_keeps_stop_reachable() {
        let mut offline = payload(TrayStatus::Error);
        offline.has_timer = true;
        let menu = ids(&offline.menu());
        assert!(menu.contains(&ID_RETRY) && menu.contains(&ID_STOP));
        assert!(!menu.contains(&ID_START_LAST));
    }

    #[test]
    fn only_window_destinations_bring_the_window_forward() {
        assert!(needs_window(ID_BACKFILL) && needs_window(ID_TIMESHEET));
        assert!(needs_window(ID_SETTINGS) && needs_window(ID_OPEN));
        assert!(!needs_window(ID_PAUSE) && !needs_window(ID_STOP));
        assert!(!is_known_action(ID_QUIT));
        assert!(!is_known_action("nope"));
    }

    #[test]
    fn payload_deserialises_from_the_webview_shape() {
        let parsed: TrayPayload = serde_json::from_str(
            r#"{"status":"paused","headline":"AV-142","elapsedSeconds":600,"hasTimer":true,"canStart":true}"#,
        )
        .expect("valid payload");
        assert_eq!(parsed.status, TrayStatus::Paused);
        assert!(parsed.can_start && parsed.has_timer && parsed.detail.is_empty());
        assert_eq!(parsed.elapsed_seconds, Some(600));
        assert!(!parsed.clock_running);
        assert!(serde_json::from_str::<TrayPayload>(r#"{"status":"loud","headline":""}"#).is_err());
    }
}
