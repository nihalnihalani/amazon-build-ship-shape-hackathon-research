/**
 * Local mirrors of the PROTOCOL.md revision 1 §3.3 phone-observation payloads.
 * Field names match PROTOCOL.md exactly. The lead switches these to imports from
 * @atr/protocol at integration; until then these are the structural contract.
 */

export type PrecheckPurpose = 'quiet_check' | 'pre_window';

export type PrecheckInvalidReason =
  | 'low_coverage'
  | 'clipped'
  | 'unstable_floor'
  | 'burst_noise'
  | 'too_loud'
  | 'nonfinite'
  | 'interrupted';

export interface PrecheckResultPayload {
  purpose: PrecheckPurpose;
  valid: boolean;
  invalid_reason: PrecheckInvalidReason | null;
  floor_dbfs: number | null;
  p20_dbfs: number | null;
  p80_dbfs: number | null;
  p95_dbfs: number | null;
  frame_count: number;
  expected_frames: number;
  coverage: number;
  clipped_frames: number;
  nonfinite_frames: number;
  duration_ms: number;
}

export type WindowKind = 'calibration' | 'vowel' | 'phrase';

export type WindowInvalidReason =
  | 'no_voice'
  | 'clipped'
  | 'low_coverage'
  | 'continuous_sound'
  | 'nonfinite'
  | 'interrupted';

export interface WindowResultPayload {
  kind: WindowKind;
  valid: boolean;
  invalid_reason: WindowInvalidReason | null;
  frame_count: number;
  expected_frames: number;
  coverage: number;
  active_ms: number;
  longest_active_ms: number;
  segments: number;
  onset_ms: number | null;
  p50_active_dbfs: number | null;
  p95_active_dbfs: number | null;
  peak_dbfs: number | null;
  clipped_frames: number;
  nonfinite_frames: number;
  duration_ms: number;
}

/** `level` message payload (PROTOCOL.md §3.3). */
export interface LevelPayload {
  frame_index: number;
  t_audio_ms: number;
  dbfs: number;
  active: boolean;
  clipped: boolean;
}

/** `MicStatePayload.state` (PROTOCOL.md §3.3), names exact. */
export type MicStateName =
  | 'off'
  | 'permission_pending'
  | 'permission_denied'
  | 'no_input'
  | 'input_busy'
  | 'constraints_unsupported'
  | 'open_idle'
  | 'measuring'
  | 'error';

/** `MicStatePayload.settings`: unknown values are null, never assumed. */
export interface MicSettingsPayload {
  auto_gain_control: boolean | null;
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
  sample_rate: number | null;
  channel_count: number | null;
}

/**
 * `MicStatePayload.supported`. PROTOCOL.md rev 1 types these as `boolean`; this package
 * reports `null` when the browser did not expose `getSupportedConstraints()` at all
 * (unknown must never be reported as false). A contract change request to widen the
 * protocol type to `boolean | null` accompanies this package.
 */
export interface MicSupportedPayload {
  auto_gain_control: boolean | null;
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
}
