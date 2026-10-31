//! Tray icon artwork drawn in code so no image decoder or binary asset is needed.
//! Each state has its own glyph on a coloured tile: the state is readable without
//! colour (ring = idle, play = running, pause bars = paused, exclamation = error).

use super::model::TrayStatus;

pub const ICON_SIZE: u32 = 32;

const SAMPLES: u32 = 3;
const WHITE: [u8; 3] = [255, 255, 255];

fn tile_colour(status: TrayStatus) -> [u8; 3] {
    match status {
        TrayStatus::Idle => [0x47, 0x55, 0x69],
        TrayStatus::Running => [0x0b, 0x6f, 0xa4],
        TrayStatus::Paused => [0xb4, 0x53, 0x09],
        TrayStatus::Error => [0xb4, 0x23, 0x18],
    }
}

fn in_rounded_tile(x: f32, y: f32) -> bool {
    let (min, max, radius) = (0.03_f32, 0.97_f32, 0.24_f32);
    if x < min || x > max || y < min || y > max {
        return false;
    }
    let cx = x.clamp(min + radius, max - radius);
    let cy = y.clamp(min + radius, max - radius);
    (x - cx).powi(2) + (y - cy).powi(2) <= radius * radius
}

fn in_triangle(x: f32, y: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
    let sign = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| {
        (p.0 - r.0) * (q.1 - r.1) - (q.0 - r.0) * (p.1 - r.1)
    };
    let p = (x, y);
    let d1 = sign(p, a, b);
    let d2 = sign(p, b, c);
    let d3 = sign(p, c, a);
    let negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(negative && positive)
}

fn in_rect(x: f32, y: f32, x0: f32, x1: f32, y0: f32, y1: f32) -> bool {
    x >= x0 && x <= x1 && y >= y0 && y <= y1
}

fn in_glyph(status: TrayStatus, x: f32, y: f32) -> bool {
    match status {
        TrayStatus::Idle => {
            let distance = ((x - 0.5).powi(2) + (y - 0.5).powi(2)).sqrt();
            (0.17..=0.29).contains(&distance)
        }
        TrayStatus::Running => in_triangle(x, y, (0.37, 0.25), (0.37, 0.75), (0.75, 0.5)),
        TrayStatus::Paused => {
            in_rect(x, y, 0.30, 0.44, 0.26, 0.74) || in_rect(x, y, 0.56, 0.70, 0.26, 0.74)
        }
        TrayStatus::Error => {
            in_rect(x, y, 0.44, 0.56, 0.22, 0.58)
                || ((x - 0.5).powi(2) + (y - 0.74).powi(2)).sqrt() <= 0.075
        }
    }
}

/// RGBA pixels, row-major, `size` by `size`.
pub fn render(status: TrayStatus, size: u32) -> Vec<u8> {
    let tile = tile_colour(status);
    let mut pixels = Vec::with_capacity((size * size * 4) as usize);
    let total = (SAMPLES * SAMPLES) as f32;
    for row in 0..size {
        for column in 0..size {
            let mut covered = 0.0_f32;
            let mut colour = [0.0_f32; 3];
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x = (column as f32 + (sx as f32 + 0.5) / SAMPLES as f32) / size as f32;
                    let y = (row as f32 + (sy as f32 + 0.5) / SAMPLES as f32) / size as f32;
                    if !in_rounded_tile(x, y) {
                        continue;
                    }
                    let source = if in_glyph(status, x, y) { WHITE } else { tile };
                    covered += 1.0;
                    for channel in 0..3 {
                        colour[channel] += source[channel] as f32;
                    }
                }
            }
            if covered == 0.0 {
                pixels.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                for channel in colour {
                    pixels.push((channel / covered).round() as u8);
                }
                pixels.push((covered / total * 255.0).round() as u8);
            }
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [TrayStatus; 4] = [
        TrayStatus::Idle,
        TrayStatus::Running,
        TrayStatus::Paused,
        TrayStatus::Error,
    ];

    #[test]
    fn buffers_have_the_expected_size_and_transparent_corners() {
        for status in ALL {
            let pixels = render(status, ICON_SIZE);
            assert_eq!(pixels.len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
            assert_eq!(&pixels[0..4], &[0, 0, 0, 0], "corner of {status:?}");
        }
    }

    #[test]
    fn glyph_shapes_differ_between_states_not_only_colour() {
        // Compare which pixels are white glyph pixels, ignoring the tile colour.
        let masks: Vec<Vec<bool>> = ALL
            .iter()
            .map(|status| {
                render(*status, ICON_SIZE)
                    .chunks(4)
                    .map(|p| p[0] == 255 && p[1] == 255 && p[2] == 255 && p[3] == 255)
                    .collect()
            })
            .collect();
        for (i, a) in masks.iter().enumerate() {
            assert!(a.iter().any(|v| *v), "state {i} has a glyph");
            for b in masks.iter().skip(i + 1) {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn centre_of_each_glyph_matches_its_design() {
        let centre = |status: TrayStatus| {
            let pixels = render(status, ICON_SIZE);
            let at = ((ICON_SIZE / 2 * ICON_SIZE + ICON_SIZE / 2) * 4) as usize;
            pixels[at..at + 3] == WHITE
        };
        assert!(!centre(TrayStatus::Idle), "ring is hollow");
        assert!(centre(TrayStatus::Running), "play triangle covers the centre");
        assert!(!centre(TrayStatus::Paused), "gap between the pause bars");
        assert!(centre(TrayStatus::Error), "exclamation bar covers the centre");
    }
}
