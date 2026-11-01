// The layout both pages share (the receiver's and send/), read from the address and changed in a settings tab:
// tested values only, applied without reloading (the address is updated to match, so a bookmark keeps them).
// The two devices must agree; nothing here checks the other one.

export const DEFAULTS = { qam: 'adapt', carrier: 14000, preambles: 4, symbols: 8, fft: 256, subcarriers: 200, prefix: 20,
  burst: 10000, burstDb: -20 };

// [value, label] for each setting in the tab, in order.
const CHOICES = [
  ['qam', 'Mode', [['adapt', 'adaptive (bit loading, backchannel)'], ['qpsk', 'QPSK'], ['16', '16-QAM'],
    ['qpsk+16', 'two layers: QPSK + 16-QAM']]],
  ['preambles', 'Preamble symbols', [[4, '4'], [3, '3'], [2, '2']]],
  ['symbols', 'Data symbols a frame', [[8, '8'], [16, '16'], [24, '24']]],
  ['subcarriers', 'Subcarriers', [[200, '200'], [100, '100']]],
  ['carrier', 'Carrier', [[14000, '14 kHz (phones)'], [5000, '5 kHz (the Dell mic)']]],
  ['prefix', 'Cyclic prefix', [[20, '20 ms'], [40, '40 ms']]],
  ['burst', 'Backchannel bursts', [[10000, '10 kHz (quiet)'], [3200, '3.2 kHz (audible)']]],
];

const NUMBERS = ['carrier', 'preambles', 'symbols', 'fft', 'subcarriers', 'prefix', 'burst', 'burstDb'];

/** The layout from the address, with the defaults for what it leaves out. */
export function readLayout() {
  const params = new URLSearchParams(location.search);
  const layout = { ...DEFAULTS };
  if (params.has('qam')) layout.qam = params.get('qam').replace(/[ ,]/g, '+');   // a + in a URL reads as a space
  for (const key of NUMBERS) if (params.has(key)) layout[key] = Number(params.get(key));
  return layout;
}

/** Puts the layout in the address (only what differs from the defaults), without reloading. */
export function writeLayout(layout) {
  const params = new URLSearchParams(location.search);
  for (const key of ['qam', ...NUMBERS]) {
    if (layout[key] === DEFAULTS[key]) params.delete(key);
    else params.set(key, key === 'qam' ? layout.qam.replace('+', ',') : layout[key]);
  }
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
}

/** One line: the mode, subcarriers, preamble + data symbols, prefix, carrier, and the bursts when adapting. */
export function summary(layout) {
  const mode = { adapt: 'adapt', qpsk: 'QPSK', '16': '16-QAM', 'qpsk+16': 'QPSK+16' }[layout.qam] ?? layout.qam;
  const khz = hz => `${+(hz / 1000).toFixed(1)} kHz`;
  return [mode, `${layout.subcarriers} sc`, `${layout.preambles}+${layout.symbols}`, `${layout.prefix} ms`,
    khz(layout.carrier)].join(' · ') + (layout.qam === 'adapt' ? ` · bursts ${khz(layout.burst)}` : '');
}

/**
 * A warning if the bursts fall inside the receiver's band, carrier ± 3 kHz (its baseband): there the phone's own
 * burst, far louder at its mic than the signal, spoils the frames it overlaps (17 kHz bursts did, live).
 */
export function burstWarning(layout) {
  if (layout.qam !== 'adapt') return '';
  const half = 6000 / 2, burstHalf = 600;
  return Math.abs(layout.burst - layout.carrier) < half + burstHalf
    ? `Bursts at ${layout.burst} Hz fall inside the receiver's band (${layout.carrier - half}–${layout.carrier + half} Hz): ` +
      'frames will fail while they play.'
    : '';
}

/**
 * Draws the layout's choices into `container`; `onChange(layout)` gets each change, already in the address.
 * `lock(true)` disables them (the send page, while sending).
 */
export function settingsTab(container, layout, onChange) {
  container.insertAdjacentHTML('afterbegin', `<div class="settings-grid"></div><p class="settings-warn"></p>`);
  const grid = container.querySelector('.settings-grid');
  const warn = container.querySelector('.settings-warn');
  const selects = [];
  for (const [key, label, choices] of CHOICES) {
    const options = choices.map(([value, text]) => [String(value), text]);
    if (!options.some(([value]) => value === String(layout[key]))) {
      options.push([String(layout[key]), `${layout[key]} (from the address)`]);
    }
    const id = `setting-${key}`;
    grid.insertAdjacentHTML('beforeend', `<label for="${id}">${label}</label><select id="${id}">` +
      options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('') + '</select>');
    const select = grid.querySelector(`#${id}`);
    select.value = String(layout[key]);
    select.onchange = () => {
      layout[key] = key === 'qam' ? select.value : Number(select.value);
      writeLayout(layout);
      warn.textContent = burstWarning(layout);
      onChange(layout);
    };
    selects.push(select);
  }
  warn.textContent = burstWarning(layout);
  if (!document.getElementById('settings-style')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="settings-style">
      .settings-grid { display: grid; grid-template-columns: max-content 1fr; gap: 10px 14px; align-items: center;
        font-size: 14px; }
      .settings-grid label { color: var(--muted); }
      .settings-grid select { font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
        border-radius: 8px; padding: 6px 8px; max-width: 100%; }
      .settings-warn { color: var(--bad); font-size: 13px; margin: 10px 0 0; }
      .settings-warn:empty { display: none; }
      .settings-note { color: var(--faint); font-size: 12px; margin: 12px 0 0; }
    </style>`);
  }
  return { lock: locked => selects.forEach(s => { s.disabled = locked; }) };
}

/** Two tabs over two panes: the page's own and the settings. */
export function tabs(strip, panes) {
  const buttons = [...strip.querySelectorAll('button')];
  const show = i => {
    buttons.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i); });
    panes.forEach((p, k) => { p.hidden = k !== i; });
  };
  buttons.forEach((b, i) => { b.onclick = () => show(i); });
  if (!document.getElementById('tabs-style')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="tabs-style">
      .tabs { display: flex; gap: 4px; margin: -4px 0 12px; border-bottom: 1px solid var(--line); }
      .tabs button { font: inherit; font-size: 14px; color: var(--muted); background: none; border: 0;
        border-bottom: 2px solid transparent; padding: 6px 10px; margin-bottom: -1px; cursor: pointer; }
      .tabs button.on { color: var(--ink); border-bottom-color: var(--accent); }
      .tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    </style>`);
  }
  show(0);
}
