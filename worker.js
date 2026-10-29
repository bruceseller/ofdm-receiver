// Runs the receiver (ofdm.js, compiled from the Java by TeaVM) off the page's main thread.
// In: {type: 'configure', layout} and {type: 'samples', samples: Float32Array at 48 kHz}.
// Out: {type: 'configured', description} and {type: 'events', events: [...]}.
import { configure, push } from './ofdm.js?v=fd07a309d6';

onmessage = ({ data }) => {
  if (data.type === 'configure') {
    const l = data.layout;
    postMessage({ type: 'configured', description: configure(l.qam, l.carrier, l.symbols, l.fft, l.subcarriers, l.prefix) });
  } else if (data.type === 'samples') {
    const events = JSON.parse(push(data.samples));
    if (events.length > 0 || data.last) {
      postMessage({ type: 'events', events, last: !!data.last });
    }
  }
};
