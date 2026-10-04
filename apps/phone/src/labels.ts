import type { MicStateName, TvStage } from './ports/wire.js';

export interface MicLabel {
  /** Short badge text. "Measuring" is returned ONLY for the observed `measuring` state. */
  badge: string;
  /** Plain-language explanation and what to do next. */
  help: string;
}

/** Wording for every microphone state and the distinct failure causes behind `error`. */
export function micLabel(state: MicStateName, detail: string | null): MicLabel {
  switch (state) {
    case 'off':
      return { badge: 'Mic off', help: 'The microphone is not open. Tap Start microphone when you are ready.' };
    case 'permission_pending':
      return {
        badge: 'Waiting for permission',
        help: 'Choose Allow in the browser prompt. The microphone is not open yet. You can cancel and try again.',
      };
    case 'permission_denied':
      return {
        badge: 'Permission denied',
        help: 'This browser blocked the microphone. Open the site settings for this page (the lock or tune icon next to the address), set Microphone to Allow, then tap Start microphone again.',
      };
    case 'no_input':
      return {
        badge: 'No microphone found',
        help: 'No microphone was found on this device. Check that one is connected and enabled, then try again.',
      };
    case 'input_busy':
      if (detail === 'track_muted') {
        return {
          badge: 'Microphone muted',
          help: 'The browser or system muted the microphone (for example another app took it). Nothing is being measured. Unmute it, or tap Start microphone to try again.',
        };
      }
      return {
        badge: 'Microphone busy',
        help: 'The microphone could not be opened. Another app or tab may be using it. Close other apps that use the microphone, then try again.',
      };
    case 'constraints_unsupported':
      return {
        badge: 'Settings not supported',
        help: 'This browser could not open the microphone with the requested settings. You can try the browser defaults; the TV will be told what the browser reports.',
      };
    case 'open_idle':
      return { badge: 'Mic open, not measuring', help: 'The microphone is open but nothing is being measured.' };
    case 'measuring':
      return { badge: 'Measuring', help: 'Measuring. Please stay quiet unless the TV asks you to speak.' };
    case 'error':
      switch (detail) {
        case 'insecure_context':
          return {
            badge: 'Microphone unavailable here',
            help: 'This page is not on a secure (HTTPS) address, so the browser will not allow the microphone. Open the HTTPS link shown by the TV or the relay instead.',
          };
        case 'no_media_devices':
          return {
            badge: 'Microphone unavailable here',
            help: 'This browser does not offer microphone access to this page. Try Chrome on Android over HTTPS.',
          };
        case 'context_suspended':
          return {
            badge: 'Audio paused',
            help: 'The browser paused audio processing on this page (for example the screen turned off). Nothing is being measured. Keep this page open and visible, then tap Start microphone again.',
          };
        case 'context_closed':
        case 'track_ended':
          return {
            badge: 'Microphone stopped',
            help: 'The microphone stopped unexpectedly (it may have been unplugged or its permission removed). Tap Start microphone to try again.',
          };
        default:
          return {
            badge: 'Microphone problem',
            help: 'Something went wrong opening the microphone. Tap Start microphone to try again.',
          };
      }
  }
}

/** Neutral names for TV steps. Deliberately says nothing about results or hidden positions. */
export function stageLabel(stage: TvStage): string {
  switch (stage) {
    case 'idle':
      return 'Waiting';
    case 'pairing':
      return 'Pairing';
    case 'permission_pending':
      return 'Setting up';
    case 'quiet_check':
      return 'Quiet-room check';
    case 'calibration':
      return 'Calibration';
    case 'vowel_ready':
    case 'vowel_active':
    case 'vowel_result':
      return 'Sustained sound';
    case 'phrase_ready':
    case 'phrase_active':
      return 'Phrase practice';
    case 'response_pending':
      return 'Waiting for the listener';
    case 'reveal':
      return 'Showing the result on the TV';
    case 'summary':
      return 'Summary';
    case 'history':
      return 'History';
    case 'paused_or_invalid':
      return 'Paused';
    case 'resume_or_discard':
      return 'Resume or discard';
  }
}

export function joinRejectedText(reason: 'rejected' | 'expired' | 'room_full' | 'busy'): string {
  switch (reason) {
    case 'rejected':
      return 'The TV rejected this request. Check the code and try again.';
    case 'expired':
      return 'The code or request expired. Ask the TV for a new code and try again.';
    case 'room_full':
      return 'This TV already has a phone paired. Unpair it on the TV first.';
    case 'busy':
      return 'Another phone is joining this TV right now. Try again in a minute.';
  }
}

/** Plain text for relay error codes that can arrive while joining. */
export function joinErrorText(code: string): string {
  switch (code) {
    case 'not_found':
      return 'That code was not recognised. Check the code on the TV and try again.';
    case 'expired':
      return 'That code has expired. Ask the TV for a new code.';
    case 'join_busy':
      return 'Another phone is joining this TV right now. Try again in a minute.';
    case 'room_full':
      return 'This TV already has a phone paired. Unpair it on the TV first.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'origin_rejected':
      return 'This page is not allowed to connect to the relay. Open the link shown by the TV.';
    default:
      return 'The relay could not accept the request. Try again.';
  }
}

export function unpairedText(reason: string): string {
  switch (reason) {
    case 'tv_unpaired':
      return 'The TV removed this phone.';
    case 'room_closed':
      return 'The TV closed this pairing.';
    case 'expired':
    case 'revoked':
      return 'The pairing expired.';
    case 'superseded':
      return 'This phone was connected from another page, so this one was disconnected.';
    default:
      return 'The pairing ended.';
  }
}
