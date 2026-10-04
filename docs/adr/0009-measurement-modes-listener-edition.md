# ADR-0009: Measurement modes, device qualification and the Listener Edition

- Status: accepted (revision 1); mode selection itself is T04A and evidence-gated
- Date: 2026-10-05

## Decision

- Modes (one setting, `measurement_mode`):
  - `relative_band` (default when qualified): per-session calibration and band verdicts as in ADR-0001.
  - `listener_edition`: the listener's Heard / Not heard is the primary outcome; the arc is labelled "Relative level, this session only"; band verdicts are shown as secondary or hidden according to T04A; voice-activity duration shown only if independently qualified.
- Until T04A records an evidence-based decision, builds default to `relative_band` with the persistent caption "Relative level, this session only" and the device-qualification status "Not yet qualified on this phone" in Settings.
- Qualification protocol (frozen before trials, T04): fixed geometry 2.5–3 m, three nominal digital playback levels at least 6 dB apart without clipping, 10 randomized repeats each, real speech after tones, negative cases (fan, TV speech, second speaker, cough, music, moved phone). Record device, browser, requested constraints, reported settings, sample rate, numeric traces and limitations. Proposed acceptance (engineering proposal, not measured accuracy): monotonic medians across levels; per-level repeat SD ≤ 1 dB and spread within ±2 dB; zero clipping.
- A failed experiment is recorded as failed. Listener Edition is selected only within this same product; switching to an unrelated project requires owner direction.
- Passing qualification does **not** enable cross-day loudness comparisons or automatic target increases (ADR-0001 §10); those need separate reproducibility evidence across days, placements and sessions and a new ADR.
