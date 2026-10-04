/** Small read-only helpers shared by the machine and the view projection. */

import { HIDDEN_POSITIONS } from './constants.js';
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
