/**
 * UI-owned strings. Screen titles, bodies, button labels, results and the footer text come from the
 * session view (TvView); only fixed labels the UI itself must show live here, so one grep covers every
 * string this app authors. No program name, trademark, condition or outcome claim may appear here
 * (checked by a unit test).
 */
import type { LinkView, MicView } from '@atr/session-core';

export const FOOTER_FALLBACK = 'Not a medical device. Does not diagnose or treat any condition.';

/**
 * What the TV may say about the phone microphone. "Off" is only shown when the phone itself confirmed it
 * (MicView 'off'); a missing acknowledgement is always "state unknown".
 */
export function micText(mic: MicView): string {
  switch (mic) {
    case 'not_paired':
      return 'No phone paired';
    case 'waiting_for_permission':
      return 'Waiting for microphone permission on the phone';
    case 'permission_denied':
      return 'Microphone blocked on the phone';
    case 'no_input':
      return 'Phone reports no microphone input';
    case 'input_busy':
      return 'Phone microphone is in use by another app';
    case 'constraints_unsupported':
      return 'Phone microphone settings are not supported';
    case 'open_not_measuring':
      return 'Microphone open, not measuring';
    case 'measuring':
      return 'Measuring';
    case 'off':
      return 'Microphone off (confirmed by the phone)';
    case 'unknown':
      return 'Phone state unknown';
    case 'error':
      return 'Phone microphone error';
  }
}

export function linkText(link: LinkView): string {
  switch (link) {
    case 'offline':
      return 'Not connected';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting';
    case 'failed':
      return 'Connection failed';
  }
}

export const bannerPrefix: Record<'info' | 'warning' | 'error', string> = {
  info: 'Note',
  warning: 'Warning',
  error: 'Problem',
};

export const text = {
  statusPhoneMic: 'Phone microphone',
  statusRelay: 'Relay',
  orientationActions: 'Use the left and right or up and down buttons to move between choices. Press OK to select.',
  pairingCodeLabel: 'Pairing code',
  pairingGettingCode: 'Getting a pairing code',
  pairingQrLabel: 'QR code for pairing. You can type the pairing code on the phone instead.',
  pairingQrUnavailable: 'QR code unavailable. Type the pairing code on the phone.',
  pairingExpiresIn: 'Code expires in',
  pairingExpired: 'Code expired. Refresh the code to continue.',
  joinHeading: 'A phone wants to join. Pick the number shown on the phone.',
  joinNamePrefix: 'Name the phone gave:',
  joinNumberLabel: 'Number',
  joinRejectLabel: 'Reject',
  timerSeconds: 's',
  timerRemaining: 'remaining',
  phraseOf: 'of',
  phraseAttempt: 'Attempt',
  cuePrefix: 'Cue',
  arcLegend: 'White tick: today\'s band',
  noSession: 'No session',
  noScoredAttempts: 'No scored attempts',
  incompleteDay: 'Incomplete',
  historyDaysLabel: 'Last 7 days',
  summaryComplete: 'Session complete',
  summaryIncomplete: 'Incomplete session. It is not compared with completed sessions.',
  reachedBand: "Reached today's relative level band",
  noEligibleListener: 'No eligible listener responses',
  diagnosticsEmpty: 'No diagnostics available',
  fatalTitle: 'Something went wrong',
  fatalBody: 'The practice display stopped unexpectedly. Close the app and open it again.',
  fatalStoreMissing: 'The session engine is not available in this build.',
  aboutVersion: 'Version',
  aboutStorage:
    'Practice data stays on this TV, stored unencrypted. Delete it in Settings. Sound is never recorded or sent by this TV.',
  aboutLicenseHeading: 'Licences',
  aboutLicenses: [
    'Across the Room: MIT licence.',
    'qrcode-generator: MIT licence.',
    'React Native and React: MIT licence.',
    'Vega packages: used under the Amazon Vega SDK licence terms.',
  ],
  levelRelativeNote: 'Relative level, this session only',
} as const;
