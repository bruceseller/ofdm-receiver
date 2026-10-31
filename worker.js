// Runs the receiver and the transmitter (ofdm.js, compiled from the Java by TeaVM) off the page's main thread.
// Receiving, in: {type: 'configure', layout} and {type: 'samples', samples: Float32Array at 48 kHz}.
//   Out: {type: 'configured', description} and {type: 'events', events: [...]}.
//   With layout.qam 'adapt', map proposals also go back as bursts of sound (burst events, which the page plays).
// Sending (send/), in: {type: 'transmit', layout, message: ArrayBuffer, lead: seconds} and {type: 'pull', length};
//   layout.id is the transfer's id (12 hex digits), which its start frames carry.
//   Out: {type: 'transmitting', description} and {type: 'pulled', samples: Float32Array, events: [...]}.
//   With layout.qam 'adapt' and layout.burst (Hz), it also listens for the receiver's bursts:
//   in {type: 'heard', samples: Float32Array} from the microphone, out {type: 'events', events: [...]}.
import { configure, push, backchannel, transmit, transmitPull, transmitListen, transmitHeard } from './ofdm.js?v=d1aea21f3f';

onmessage = ({ data }) => {
  if (data.type === 'configure') {
    const l = data.layout;
    let description = configure(l.qam, l.carrier, l.symbols, l.fft, l.subcarriers, l.prefix);
    if (l.qam === 'adapt') description += '; ' + backchannel(l.burst, l.burstDb);
    postMessage({ type: 'configured', description });
  } else if (data.type === 'transmit') {
    const l = data.layout;
    let description = transmit(l.qam, l.carrier, l.symbols, l.fft, l.subcarriers, l.prefix,
      new Int8Array(data.message), data.lead);
    if (l.qam === 'adapt' && l.burst) description += '; ' + transmitListen(l.burst, l.id ?? '');
    postMessage({ type: 'transmitting', description });
  } else if (data.type === 'heard') {
    const events = JSON.parse(transmitHeard(data.samples));
    if (events.length > 0) postMessage({ type: 'events', events });
  } else if (data.type === 'pull') {
    const samples = new Float32Array(data.length);
    const events = JSON.parse(transmitPull(samples));
    postMessage({ type: 'pulled', samples, events }, [samples.buffer]);
  } else if (data.type === 'samples') {
    const events = JSON.parse(push(data.samples));
    if (events.length > 0 || data.last) {
      postMessage({ type: 'events', events, last: !!data.last });
    }
  }
};
