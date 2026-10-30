// Runs the receiver (ofdm.js, compiled from the Java by TeaVM) off the page's main thread.
// In: {type: 'configure', layout} and {type: 'samples', samples: Float32Array at 48 kHz}.
// Out: {type: 'configured', description} and {type: 'events', events: [...]}.
// With layout.qam 'adapt', map proposals also go back as bursts of sound (burst events, which the page plays).
import { configure, push, backchannel } from './ofdm.js?v=2ed32098e5';

onmessage = ({ data }) => {
  if (data.type === 'configure') {
    const l = data.layout;
    let description = configure(l.qam, l.carrier, l.symbols, l.fft, l.subcarriers, l.prefix);
    if (l.qam === 'adapt') description += '; ' + backchannel(l.burst, l.burstDb);
    postMessage({ type: 'configured', description });
  } else if (data.type === 'samples') {
    const events = JSON.parse(push(data.samples));
    if (events.length > 0 || data.last) {
      postMessage({ type: 'events', events, last: !!data.last });
    }
  }
};
