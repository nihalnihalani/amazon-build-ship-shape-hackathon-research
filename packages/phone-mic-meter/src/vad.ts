/**
 * Streaming level-based voice-activity tracker (ADR-0001 §3). It is NOT a voice
 * classifier: a cough, music or another speaker of 200 ms or more can be accepted.
 *
 * Rules (rel = frame dbfs − session floor):
 *  - Candidate frame: finite and rel ≥ 6 dB. Non-finite frames are non-candidates.
 *  - Provisional onset: the first candidate after an inactive period (display only).
 *  - Hangover: runs of fewer than 6 consecutive non-candidate frames are bridged; the 6th
 *    consecutive non-candidate frame ends the segment, and the segment ends at the end of
 *    its last candidate frame (so the hangover itself adds no duration).
 *  - Accepted segment: at least 4 candidate frames (200 ms). Its onset is the provisional
 *    onset. Rejected segments contribute nothing.
 *  - Frames missing from the sequence (a dropout: frameIndex jumps) count as non-candidates.
 */

import {
  CMP_TOLERANCE_DB,
  VAD_ACCEPT_MIN_FRAMES,
  VAD_CANDIDATE_DB,
  VAD_END_GAP_FRAMES,
} from './constants.js';
import type { Frame } from './frame.js';

export interface AcceptedSegment {
  /** Index of the provisional-onset frame. */
  onsetFrame: number;
  /** Index of the segment's last candidate frame (inclusive). */
  endFrame: number;
  /** Start time of the onset frame on the audio clock. */
  onset_ms: number;
  /** End of the last candidate frame on the audio clock. */
  end_ms: number;
  candidateFrames: number;
}

export interface VadPushResult {
  /** Provisional, display only. */
  candidate: boolean;
}

export type VadFrame = Pick<Frame, 'frameIndex' | 't_audio_ms' | 'duration_ms' | 'dbfs' | 'finite'>;

export class VoiceActivityTracker {
  readonly sessionFloorDbfs: number;

  private readonly accepted: AcceptedSegment[] = [];
  private rejected = 0;
  private expectedNext: number | null = null;

  private open = false;
  private onsetFrame = 0;
  private onsetMs = 0;
  private lastCandidateFrame = 0;
  private lastCandidateEndMs = 0;
  private candidateCount = 0;
  private gapRun = 0;

  private finished = false;
  private lastAcceptedEndedByFinish = false;

  constructor(sessionFloorDbfs: number) {
    if (!Number.isFinite(sessionFloorDbfs)) throw new RangeError('sessionFloorDbfs must be finite');
    this.sessionFloorDbfs = sessionFloorDbfs;
  }

  /** Number of completed segments that were rejected (fewer than 4 candidate frames). */
  get rejectedSegments(): number {
    return this.rejected;
  }

  /** True when the last accepted segment was still open (no offset seen) when finish() ran. */
  get lastSegmentUnterminated(): boolean {
    return this.lastAcceptedEndedByFinish;
  }

  push(frame: VadFrame): VadPushResult {
    if (this.finished) return { candidate: false };

    if (this.expectedNext === null) {
      this.expectedNext = frame.frameIndex;
    }
    if (frame.frameIndex < this.expectedNext) {
      // Duplicate or out-of-order frame: ignored.
      return { candidate: false };
    }
    const missing = frame.frameIndex - this.expectedNext;
    for (let i = 0; i < Math.min(missing, VAD_END_GAP_FRAMES); i++) {
      this.nonCandidate();
    }
    this.expectedNext = frame.frameIndex + 1;

    const candidate =
      frame.finite && frame.dbfs - this.sessionFloorDbfs >= VAD_CANDIDATE_DB - CMP_TOLERANCE_DB;

    if (candidate) {
      if (!this.open) {
        this.open = true;
        this.onsetFrame = frame.frameIndex;
        this.onsetMs = frame.t_audio_ms;
        this.candidateCount = 0;
      }
      this.candidateCount += 1;
      this.lastCandidateFrame = frame.frameIndex;
      this.lastCandidateEndMs = frame.t_audio_ms + frame.duration_ms;
      this.gapRun = 0;
    } else {
      this.nonCandidate();
    }
    return { candidate };
  }

  /**
   * Close any open segment at the end of the stream and return the accepted segments in
   * time order. Idempotent: later calls return the same list.
   */
  finish(): AcceptedSegment[] {
    if (!this.finished) {
      this.finished = true;
      if (this.open) {
        const acceptedNow = this.closeSegment();
        this.lastAcceptedEndedByFinish = acceptedNow;
      }
    }
    return this.accepted.map((s) => ({ ...s }));
  }

  private nonCandidate(): void {
    if (!this.open) return;
    this.gapRun += 1;
    if (this.gapRun >= VAD_END_GAP_FRAMES) {
      this.closeSegment();
    }
  }

  /** Returns true when the closed segment was accepted. */
  private closeSegment(): boolean {
    const accepted = this.candidateCount >= VAD_ACCEPT_MIN_FRAMES;
    if (accepted) {
      this.accepted.push({
        onsetFrame: this.onsetFrame,
        endFrame: this.lastCandidateFrame,
        onset_ms: this.onsetMs,
        end_ms: this.lastCandidateEndMs,
        candidateFrames: this.candidateCount,
      });
    } else {
      this.rejected += 1;
    }
    this.open = false;
    this.gapRun = 0;
    this.candidateCount = 0;
    return accepted;
  }
}
