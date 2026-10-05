/** Small read-only helpers shared by the machine and the view projection. */

import { HIDDEN_POSITIONS, QUIET_LEAD_MS, QUIET_LEAD_SCREEN_READER_MS } from './constants.js';
import type { LinkView, MicView } from './contract.js';
import type { Core, Session } from './model.js';
import type { AttemptRecord } from './records.js';

export const isHiddenPosition = (position: number): boolean => HIDDEN_POSITIONS.includes(position);

export function linkView(s: Core): LinkView {
  if (s.link === 'connected' && !s.authed) return 'connecting';
  return s.link;
}

/** Link is authenticated and usable for protected messages. */
export const linkUp = (s: Core): boolean => s.link === 'connected' && s.authed;

/**
 * What the TV may say about the phone microphone. "off" appears only after the phone said off.
 * After any link loss or phone disconnect the state is unknown until the phone reports again.
 */
export function micView(s: Core): MicView {
  if (!s.phonePaired && !s.peerConnected) return 'not_paired';
  if (!linkUp(s) || !s.peerConnected || s.mic.state === null) return 'unknown';
  switch (s.mic.state) {
    case 'permission_pending':
      return 'waiting_for_permission';
    case 'permission_denied':
      return 'permission_denied';
    case 'no_input':
      return 'no_input';
    case 'input_busy':
      return 'input_busy';
    case 'constraints_unsupported':
      return 'constraints_unsupported';
    case 'open_idle':
      return 'open_not_measuring';
    case 'measuring':
      return 'measuring';
    case 'off':
      return 'off';
    case 'error':
      return 'error';
  }
}

/** True once the phone has acked this session's session.begin as applied (DEF-003). */
export const beginAcked = (s: Core): boolean => s.session !== null && s.session.beginAcked;

/**
 * A measurement may begin: the microphone is open and the phone is reachable AND the phone has acked the current
 * session.begin, so it knows the session the commands belong to.
 */
export const measureReady = (s: Core): boolean => micOpen(s) && beginAcked(s);

/** The microphone is open and the phone is reachable, so a window may begin. */
export const micOpen = (s: Core): boolean =>
  linkUp(s) && s.peerConnected && (s.mic.state === 'open_idle' || s.mic.state === 'measuring');

export function currentAttempt(session: Session | null): AttemptRecord | null {
  if (!session || session.currentAttemptId === null) return null;
  return session.attempts.find((a) => a.attemptId === session.currentAttemptId) ?? null;
}

/** True while a hidden first attempt has not been revealed and is not already unscored (invalid or cancelled). */
export function isBlindPending(attempt: AttemptRecord | null): boolean {
  if (!attempt || !attempt.hidden) return false;
  return attempt.state === 'capturing' || attempt.state === 'capture_closed' || attempt.state === 'response_pending';
}

export function attemptsAt(session: Session, position: number): AttemptRecord[] {
  return session.attempts.filter((a) => a.position === position);
}

/** True when a phrase position has been captured at least once (a blocked attempt never started). */
export const hasStartedAttempt = (session: Session, position: number): boolean =>
  attemptsAt(session, position).some((a) => a.started);

export const winActive = (s: Core): boolean => s.win !== null;

/** A9-02: the failed qualification forces Listener Edition; a configured Listener Edition behaves the same way. */
export const isListenerEdition = (s: Core): boolean =>
  s.settings.qualification === 'failed' || s.settings.measurementMode === 'listener_edition';

/**
 * True while nothing derived from level or verdict may reach the view: a hidden first attempt is in its quiet
 * lead, precheck or capture, or waits behind the neutral prompt for its reveal (A4-03, A8-01).
 */
export function isBlindNow(s: Core): boolean {
  if (s.win !== null && s.win.kind === 'phrase' && s.win.hidden) return true;
  return s.stage === 'response_pending' && isBlindPending(currentAttempt(s.session));
}

/**
 * Quiet lead after the OK press (ADR-0008). With the TV screen reader on it is longer (A8-02) so the announced
 * script can finish; both values are configurable in settings and shown in Diagnostics.
 */
export function quietLeadMs(s: Core): number {
  return s.screenReader
    ? (s.settings.quietLeadScreenReaderMs ?? QUIET_LEAD_SCREEN_READER_MS)
    : (s.settings.quietLeadMs ?? QUIET_LEAD_MS);
}
