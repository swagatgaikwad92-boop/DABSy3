// Inline SVG icon set — 24px grid, 1.8 stroke, rounded. One consistent geometry for the whole app.
import { s } from '../core/dom.js';

const P = {
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  stop: 'M7.5 7.5h9v9h-9z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10.5 11v5M13.5 11v5',
  edit: 'M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18z',
  book: 'M5 5.5A1.5 1.5 0 0 1 6.5 4H12v15H6.5A1.5 1.5 0 0 0 5 20.5zM19 5.5A1.5 1.5 0 0 0 17.5 4H12v15h5.5a1.5 1.5 0 0 1 1.5 1.5z',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  refresh: 'M19 12a7 7 0 1 1-2.2-5.1M19 4v4.5h-4.5',
  calendar: 'M5 6.5h14v13H5zM5 10.5h14M9 4v4M15 4v4',
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 7.5V12l3 2',
  list: 'M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  play: 'M8 5.5v13l10-6.5z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z',
  eyeOff: 'M4 4l16 16M9.9 6a9 9 0 0 1 2.1-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.3M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.6-.8',
  bolt: 'M13 3 5.5 13.5H12L11 21l7.5-10.5H12z',
  pin: 'M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16A2.5 2.5 0 0 1 5 13.5z',
  flag: 'M6 20V4.5M6 5h10.5l-2 3.5 2 3.5H6',
  undo: 'M9 8H4V3M4.5 8a8 8 0 1 1-1.2 6',
  newChat: 'M5 5h8M5 5v14h14v-8M16.5 3.5l4 4-6.5 6.5-4.5 1 1-4.5z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  dot: 'M12 12h.01',
  // weather glyphs
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  cloud: 'M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6 4.5 4.5 0 0 0 7 18.5z',
  rain: 'M7 14.5h10a3.8 3.8 0 0 0 .5-7.6A5.3 5.3 0 0 0 7.2 6 4.3 4.3 0 0 0 7 14.5zM8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5',
  snow: 'M7 14h10a3.8 3.8 0 0 0 .5-7.6A5.3 5.3 0 0 0 7.2 5.5 4.3 4.3 0 0 0 7 14zM8.5 18h.01M12 19.5h.01M15.5 18h.01M10 21h.01M14 21h.01',
  storm: 'M7 13.5h10a3.8 3.8 0 0 0 .5-7.6A5.3 5.3 0 0 0 7.2 5 4.3 4.3 0 0 0 7 13.5zM12.5 13.5 10 18h3.5L11.5 22',
  fog: 'M7 12h10a3.8 3.8 0 0 0 .5-7.6A5.3 5.3 0 0 0 7.2 3.5 4.3 4.3 0 0 0 7 12zM5 15.5h14M7 19h10',
};

export function icon(name, size = 20, props = {}) {
  const d = P[name];
  if (!d) throw new Error(`unknown icon: ${name}`);
  const filled = name === 'stop' || name === 'play';
  return s(
    'svg',
    {
      viewBox: '0 0 24 24', width: size, height: size, fill: filled ? 'currentColor' : 'none', stroke: 'currentColor',
      'stroke-width': props.stroke ?? 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
      class: 'icon' + (props.class ? ' ' + props.class : ''), focusable: 'false',
    },
    s('path', { d }),
  );
}

export const hasIcon = (n) => n in P;

/** WMO weather code → icon + label (Open-Meteo). */
export function weatherGlyph(code, isDay = true) {
  const c = Number(code);
  if (c === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear' };
  if (c === 1 || c === 2) return { icon: isDay ? 'sun' : 'moon', label: c === 1 ? 'Mostly clear' : 'Partly cloudy', partly: true };
  if (c === 3) return { icon: 'cloud', label: 'Overcast' };
  if (c === 45 || c === 48) return { icon: 'fog', label: 'Fog' };
  if (c >= 51 && c <= 57) return { icon: 'rain', label: 'Drizzle' };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { icon: 'rain', label: 'Rain' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: 'snow', label: 'Snow' };
  if (c >= 95) return { icon: 'storm', label: 'Thunderstorm' };
  return { icon: 'cloud', label: 'Cloudy' };
}
