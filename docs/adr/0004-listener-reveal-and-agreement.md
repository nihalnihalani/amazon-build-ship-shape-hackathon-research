# ADR-0004: Hidden-meter checks, listener responses, reveal timing and agreement

- Status: accepted (revision 1)
- Date: 2026-10-05
- Amended: revision 2 decisions in [AMENDMENTS-REV2.md](AMENDMENTS-REV2.md) override conflicting text below (2026-10-05)

## Decision

### Attempts

- Every measurement attempt has a unique `window_id` and `attempt_id`. A retry of the same phrase gets a new `window_id` and `attempt_id` with `attempt_number = n + 1`.

### Hidden-meter positions

- Phrase positions 3, 6 and 9 (1-based) are hidden when they exist in the selected bank (a 4-phrase bank has only position 3 hidden).
- Only the **first attempt** at a hidden position is hidden. Retries show the meter and are marked `meter_visibility: visible_retry`.
- During a hidden capture the TV renders **no** arc, no band tick, no colour change, no result text and no accessible label or announcement that depends on level. The level stream is still received and validated but not rendered or announced. The phone never displays levels or verdicts at all and is never told which positions are hidden.

### Response phase (after capture closes)

When a valid window result arrives, the attempt enters `response_pending`. Required inputs:

- `speaker_rating` (TV remote: Felt loud / Felt normal / Skip rating) — required only for hidden first attempts.
- `listener_response` (phone: Heard / Not heard; optional Cue) — required only in family mode.

Reveal happens when every required input is present or explicitly skipped by the speaker. If the listener has not answered after 20 s, the TV offers "Continue without listener response" (focused second, after "Keep waiting"); choosing it records `listener_response: missing` — never an invented answer. There is no timer on the speaker rating.

Invalid or cancelled windows skip the response phase: they reveal immediately as "Not scored" with the reason, and listener controls are not opened for them.

### Reveal

- `attempt.reveal` locks the attempt. Its verdict, rating and on-time listener response are final.
- A listener response that arrives after reveal is stored with `late: true` and excluded from the primary agreement denominator; it is listed separately in the summary as "late responses".

### Cues

- One cue word per household, 1–12 characters after trim and NFC normalization, literal text. Maximum 3 cues per session, enforced by the phone UI, by the relay (per-session counter, rejects the 4th with `cue_limit`) and by the TV session state (authoritative; ignores and acknowledges `rejected` beyond 3). Cues are displayed neutrally for 3 s and never change a verdict.

### Agreement

- Eligible attempt: verdict ∈ {reached, not_reached} **and** on-time listener response ∈ {heard, not_heard}.
- Agree: (reached ∧ heard) ∨ (not_reached ∧ not_heard).
- Report `agree / eligible` separately for **hidden** first attempts and **visible** attempts (visible includes visible retries), plus the combined total. Always show the denominator; with zero eligible attempts show "No eligible listener responses".
- Agreement is a household check, not intelligibility, comprehension or a clinical measure.

### Summary counts

- `phrases_completed`: phrase positions with at least one valid scored attempt.
- `phrases_attempted`: phrase positions with at least one started attempt.
- `phrases_skipped`: positions the speaker skipped without a valid attempt.
- `attempts_invalid`: attempts that ended unscored (with reason counts).
- Reached counts are per phrase position using the **first valid attempt** for hidden positions and the **best valid attempt** otherwise; both rules are labelled in the summary.
- An incomplete session (ended early, crashed and discarded, or resumed) is labelled incomplete and is never compared against a completed-session total.
