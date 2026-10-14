// PulseForge master meter — AudioWorklet peak/RMS/clip detection off the main thread.
class PFMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peak = 0;
    this.rmsAcc = 0;
    this.rmsCount = 0;
    this.clipped = false;
    this.frames = 0;
    this.port.onmessage = (e) => { if (e.data === "reset") this.clipped = false; };
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      for (const channel of input) {
        for (let i = 0; i < channel.length; i++) {
          const a = Math.abs(channel[i]);
          if (a > this.peak) this.peak = a;
          if (a >= 0.999) this.clipped = true;
          this.rmsAcc += channel[i] * channel[i];
          this.rmsCount++;
        }
      }
    }
    this.frames++;
    // post roughly every 43ms at 128-frame quanta / 48k
    if (this.frames >= 16) {
      this.port.postMessage({
        peak: this.peak,
        rms: this.rmsCount ? Math.sqrt(this.rmsAcc / this.rmsCount) : 0,
        clipped: this.clipped,
      });
      this.peak *= 0.5; // decay
      this.rmsAcc = 0;
      this.rmsCount = 0;
      this.frames = 0;
    }
    return true;
  }
}
registerProcessor("pf-meter", PFMeterProcessor);
