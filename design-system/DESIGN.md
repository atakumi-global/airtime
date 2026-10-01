# DESIGN.md — Airtime

> The binding visual contract for this product. It is deliberately thin: the
> **approved coded design set is `prototypes/AIRTIME-16/v2`** (static HTML, light
> and dark, WCAG 2.2 AA target), and `v1` is kept for comparison only. Where a
> design decision is not covered here or in `v2`, ask before inventing it.

## Canonical sources

1. `prototypes/AIRTIME-16/v2/` — the approved screens, foundation and components.
2. `prototypes/AIRTIME-16/v1/` — superseded; useful for history, never a target.
3. This file — the enforceable summary.

## Non-negotiables

- **Implement against `v2`.** Do not redesign from memory or improvise a screen
  that already exists in the set.
- **Accessibility is a target, not a pass:** WCAG 2.2 AA contrast, keyboard
  navigation, visible focus, semantic HTML, in **both light and dark**.
- Money is financial data: never display a raw `Decimal`; convert explicitly and
  format consistently with the server's currency handling.
- Dates and durations follow the patterns already in the coded design (duration
  parser shared by timesheet, back-fill and edit).
- No new UI primitives when the design set already defines the component; the
  desktop client is ported from the coded designs, not the other way round.

## Design before build

Any design outcome — new or changed screen, layout, styling, user-visible copy,
or interaction — is designed, versioned under `prototypes/<work-item-id>/v1`,
`v2`, … and approved (recorded in Plane) before implementation. Never overwrite a
previous version.

## Before you say done

- [ ] The screen matches `prototypes/AIRTIME-16/v2`
- [ ] WCAG 2.2 AA: contrast, focus, keyboard, headings, 200% zoom
- [ ] Light and dark both look right
- [ ] Money and duration formatting matches the existing patterns
- [ ] The design version being built is the one approved in Plane
