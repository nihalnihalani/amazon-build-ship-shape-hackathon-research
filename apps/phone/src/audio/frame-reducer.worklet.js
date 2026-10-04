// AudioWorklet module. Runs on the audio thread. It reduces each 50 ms frame of microphone
// samples to a few numbers INSIDE the worklet; raw samples are never posted anywhere.
// It processes nothing between runs (the mic can be open while "not measuring").
class AtrFrameReducer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = false;
    this.alive = true;
    this.runId = 0;
    this.frameSize = 2400;
    this.reset();
    this.port.onmessage = (event) => {
      const m = event.data;
      if (m && m.type === 'begin') {
        this.runId = m.runId;
        this.frameSize = m.frameSize;
        this.index = 0;
        this.reset();
        this.running = true;
      } else if (m && m.type === 'end') {
        this.running = false;
        this.reset();
      } else if (m && m.type === 'dispose') {
        this.running = false;
        this.alive = false;
      }
    };
  }

  reset() {
    this.count = 0;
    this.sumSq = 0;
    this.clipped = 0;
    this.nonFinite = false;
  }

  emit() {
    this.port.postMessage({
      type: 'frame',
      runId: this.runId,
      index: this.index,
      sumSq: this.sumSq,
      count: this.count,
      clipped: this.clipped,
      nonFinite: this.nonFinite,
    });
    this.index += 1;
    this.reset();
  }

  process(inputs) {
    if (!this.alive) return false;
    if (!this.running) return true;
    const channel = inputs[0] && inputs[0][0];
    const length = channel ? channel.length : 128;
    for (let i = 0; i < length; i++) {
      if (channel) {
        const x = channel[i];
        if (Number.isFinite(x)) {
          this.sumSq += x * x;
          if (Math.abs(x) >= 0.999) this.clipped += 1;
        } else {
          this.nonFinite = true;
        }
      } else {
        // Input missing for this render quantum: counts as a dropout (non-finite frame).
        this.nonFinite = true;
      }
      this.count += 1;
      if (this.count >= this.frameSize) this.emit();
    }
    return true;
  }
}
registerProcessor('atr-frame-reducer', AtrFrameReducer);
