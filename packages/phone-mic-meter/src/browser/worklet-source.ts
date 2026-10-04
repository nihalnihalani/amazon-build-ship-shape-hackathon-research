/**
 * AudioWorklet frame processor, shipped as a source string so that it can be loaded from a
 * Blob URL or written to a static file by the phone build (see worklet-loader.ts).
 *
 * The processor reduces every 50 ms frame INSIDE the worklet to scalars and posts only
 * { firstSampleIndex, n, sumSquares, peak, clippedCount, nonfinite, epoch }. It never posts
 * samples, arrays or buffers, and it writes nothing to its output (silence).
 *
 * The reduction arithmetic is a hand-inlined copy of reduceInto() in ../frame.ts (a worklet
 * cannot import modules). test/worklet.test.ts evaluates this string in a sandbox and asserts
 * bit-identical results against reduceFrame(), so the two cannot drift silently.
 *
 * Control messages in: { cmd: 'start', epoch }, { cmd: 'stop' }, { cmd: 'close' }.
 *  - start: frame 0 begins at the next render quantum; firstSampleIndex is counted from there.
 *  - A jump in `currentFrame` (a render discontinuity) drops the partial frame and re-bases,
 *    so a gap shows up as a jump in firstSampleIndex and lowers coverage downstream.
 *  - close: process() returns false so the processor can be released.
 * The epoch is echoed so the main thread can discard frames from an earlier measurement.
 */

import { CLIP_SAMPLE, FRAME_MS } from '../constants.js';

/** Name passed to registerProcessor() and to the AudioWorkletNode constructor. */
export const FRAME_PROCESSOR_NAME = 'atr-frame-processor';

export const FRAME_PROCESSOR_SOURCE = `var ATR_FRAME_MS = ${FRAME_MS};
var ATR_CLIP_SAMPLE = ${CLIP_SAMPLE};

class AtrFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameLength = Math.round(sampleRate * ATR_FRAME_MS / 1000);
    this.alive = true;
    this.measuring = false;
    this.epoch = 0;
    this.baseSet = false;
    this.base = 0;
    this.expected = 0;
    this.resetFrame();
    var self = this;
    this.port.onmessage = function (event) {
      var d = event.data;
      if (!d) return;
      if (d.cmd === 'start') {
        self.measuring = true;
        self.epoch = d.epoch;
        self.baseSet = false;
        self.resetFrame();
      } else if (d.cmd === 'stop') {
        self.measuring = false;
        self.resetFrame();
      } else if (d.cmd === 'close') {
        self.alive = false;
        self.measuring = false;
        self.resetFrame();
      }
    };
  }

  resetFrame() {
    this.n = 0;
    this.sumSquares = 0;
    this.peak = 0;
    this.clippedCount = 0;
    this.nonfinite = false;
    this.frameStart = 0;
  }

  process(inputs) {
    if (!this.alive) return false;
    if (!this.measuring) return true;
    var input = inputs[0];
    var channel = input && input[0];
    if (!channel) return true;

    var rel;
    if (!this.baseSet) {
      this.base = currentFrame;
      this.baseSet = true;
      this.expected = 0;
      rel = 0;
    } else {
      rel = currentFrame - this.base;
      if (rel !== this.expected) {
        this.resetFrame();
        this.expected = rel;
      }
    }

    for (var i = 0; i < channel.length; i++) {
      if (this.n === 0) this.frameStart = rel + i;
      var x = channel[i];
      if (x !== x || x === Infinity || x === -Infinity) {
        this.nonfinite = true;
      } else {
        var a = x < 0 ? -x : x;
        this.sumSquares += x * x;
        if (a > this.peak) this.peak = a;
        if (a >= ATR_CLIP_SAMPLE) this.clippedCount += 1;
      }
      this.n += 1;
      if (this.n === this.frameLength) {
        this.port.postMessage({
          firstSampleIndex: this.frameStart,
          n: this.n,
          sumSquares: this.sumSquares,
          peak: this.peak,
          clippedCount: this.clippedCount,
          nonfinite: this.nonfinite,
          epoch: this.epoch
        });
        this.resetFrame();
      }
    }
    this.expected = rel + channel.length;
    return true;
  }
}

registerProcessor('${FRAME_PROCESSOR_NAME}', AtrFrameProcessor);
`;
