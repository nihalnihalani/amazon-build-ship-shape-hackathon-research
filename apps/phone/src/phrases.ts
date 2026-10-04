import { LIMITS } from './config.js';
import { validateCue as protocolValidateCue, validateDeviceLabel as protocolValidateLabel, validatePhrase } from './ports/wire.js';
import { checkText, type TextProblem } from './text.js';

export interface PhraseIssue {
  /** Zero-based row index. */
  index: number;
  problem: TextProblem;
  message: string;
}

export interface PhraseValidation {
  ok: boolean;
  /** NFC + trimmed phrases in order (only meaningful when ok). */
  phrases: string[];
  issues: PhraseIssue[];
  /** List-level problem (too few / too many), or null. */
  listMessage: string | null;
}

/** One plain sentence per rejection reason, shared by phrases, the cue word and the device name. */
function problemSentence(subject: string, problem: TextProblem): string {
  switch (problem) {
    case 'invalid_characters':
      return `${subject} contains a control character, which cannot be sent. Remove it.`;
    case 'unsafe_character':
      return `${subject} contains a character that cannot be shown safely (such as a text-direction control or an invisible separator). Remove it.`;
    case 'invisible':
      return `${subject} has nothing visible in it. Type some text.`;
    case 'combining_run':
      return `${subject} has more than 4 accent or combining marks in a row, which cannot be shown cleanly. Remove some.`;
    case 'empty':
    case 'too_long':
      return `${subject} is not valid.`; // handled with counts by the callers
  }
}

function rowMessage(index: number, problem: TextProblem, length: number): string {
  const n = index + 1;
  switch (problem) {
    case 'empty':
      return `Phrase ${n} is empty. Type a phrase or remove it.`;
    case 'too_long':
      return `Phrase ${n} is ${length} characters; the limit is ${LIMITS.phraseMaxCodePoints}.`;
    default:
      return problemSentence(`Phrase ${n}`, problem);
  }
}

/** Validates the household phrase list exactly per PROTOCOL.md (1-10 phrases, 1-60 code points). */
export function validatePhrases(rawList: readonly string[]): PhraseValidation {
  const issues: PhraseIssue[] = [];
  const phrases: string[] = [];
  rawList.forEach((raw, index) => {
    const check = checkText(raw, validatePhrase);
    phrases.push(check.text);
    if (!check.ok && check.problem !== null) {
      issues.push({ index, problem: check.problem, message: rowMessage(index, check.problem, check.length) });
    }
  });
  let listMessage: string | null = null;
  if (rawList.length < LIMITS.phrasesMin) {
    listMessage = `Add at least ${LIMITS.phrasesMin} phrase.`;
  } else if (rawList.length > LIMITS.phrasesMax) {
    listMessage = `Use at most ${LIMITS.phrasesMax} phrases; you have ${rawList.length}.`;
  }
  return { ok: issues.length === 0 && listMessage === null, phrases, issues, listMessage };
}

export interface CueValidation {
  ok: boolean;
  text: string;
  message: string | null;
}

/** Cue word: 1-12 code points after NFC + trim, literal text, control characters rejected. */
export function validateCue(raw: string): CueValidation {
  const check = checkText(raw, protocolValidateCue);
  if (check.ok) return { ok: true, text: check.text, message: null };
  switch (check.problem) {
    case 'empty':
      return { ok: false, text: check.text, message: 'The cue word cannot be empty.' };
    case 'too_long':
      return {
        ok: false,
        text: check.text,
        message: `The cue word is ${check.length} characters; the limit is ${LIMITS.cueMaxCodePoints}.`,
      };
    default:
      return { ok: false, text: check.text, message: problemSentence('The cue word', check.problem ?? 'invalid_characters') };
  }
}

export function validateDeviceLabel(raw: string): CueValidation {
  const check = checkText(raw, protocolValidateLabel);
  if (check.ok) return { ok: true, text: check.text, message: null };
  if (check.problem === 'too_long') {
    return {
      ok: false,
      text: check.text,
      message: `The device name is ${check.length} characters; the limit is ${LIMITS.deviceLabelMax}.`,
    };
  }
  if (check.problem === 'empty') return { ok: false, text: check.text, message: 'Give this phone a short name.' };
  return { ok: false, text: check.text, message: problemSentence('The device name', check.problem ?? 'invalid_characters') };
}
