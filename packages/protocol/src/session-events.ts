/**
 * TV-local session events (docs/PROTOCOL.md section 5). These are typed inputs
 * to the TV session reducer and are never sent over the wire. Types only.
 */

import type { SPEAKER_RATINGS } from './constants.js';
import type { TransportState, WireMessage } from './types.js';

export type SpeakerRating = (typeof SPEAKER_RATINGS)[number];

export type RemoteEvent =
  | { type: 'remote.ok' }
  | { type: 'remote.back' }
  | { type: 'remote.up' }
  | { type: 'remote.down' }
  | { type: 'remote.left' }
  | { type: 'remote.right' };

export type SpeakerRatingEvent = { type: 'speaker.rating'; rating: SpeakerRating };
export type UiConfirmSkipListenerEvent = { type: 'ui.confirm_skip_listener' };
export type TimerListenerTimeoutEvent = { type: 'timer.listener_timeout' };
export type TimerWindowMaxEvent = { type: 'timer.window_max' };
export type TransportStateEvent = { type: 'transport.state'; state: TransportState };
/** A wire message that has already passed `parseWireMessage` and the connection checks. */
export type WireMessageEvent = { type: 'wire'; message: WireMessage };

/** Every event the TV session reducer accepts. */
export type SessionEvent =
  | RemoteEvent
  | SpeakerRatingEvent
  | UiConfirmSkipListenerEvent
  | TimerListenerTimeoutEvent
  | TimerWindowMaxEvent
  | TransportStateEvent
  | WireMessageEvent;

export type SessionEventType = SessionEvent['type'];
