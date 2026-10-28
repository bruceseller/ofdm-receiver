// AudioWorklet processor: passes the microphone's samples to the page in blocks of 50 ms.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2400);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0][0];
    if (samples) {
      for (let i = 0; i < samples.length; i++) {
        this.block[this.filled++] = samples[i];
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(2400);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture', Capture);
