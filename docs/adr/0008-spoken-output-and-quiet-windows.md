# ADR-0008: Spoken output, VoiceView and quiet measurement windows

- Status: accepted (revision 1)
- Date: 2026-10-05

## Decision

- The TV plays no app audio in the core release (text prompts only; Polly is a stretch item and, if added, plays only between windows).
- VoiceView is never disabled by the app. Instead:
  - Instructions for the next window are exposed as accessible text and announced **before** the window starts (live region update when the "ready" screen appears).
  - Starting a window is an explicit OK press. After OK the TV waits 1.5 s (`QUIET_LEAD_MS`) before sending `precheck.start`, so a screen-reader utterance triggered by the press can finish.
  - During a precheck or capture, routine live-region updates are suppressed (the arc and timer are `importantForAccessibility="no-hide-descendants"` while capturing; level values are never announced). Emergency controls (Back/cancel) remain focusable and labelled.
  - Results are announced after capture closes, and for hidden attempts only after reveal.
- Contamination guard: the pre-window precheck (ADR-0001 §5) blocks a window if TV speech or other sound raises the floor; the user sees "The room is noisier than when we set today's band" and can retry. This is a detection guard, not a guarantee; actual VoiceView timing on the VVD is a T17 observation.
