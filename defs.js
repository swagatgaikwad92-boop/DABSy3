// The widgets. Each renders real data from the app's stores and says so honestly when there is none.
import { h } from '../core/dom.js';
import { icon, weatherGlyph } from '../ui/icons.js';
import { bus, plural } from '../core/util.js';
import { prefs, tasks as tasksStore, events as eventsStore, study as studyStore, weather as weatherStore } from '../core/state.js';
import * as T from '../butler/tasks.js';
import * as E from '../butler/events.js';
import * as P from '../study/progress.js';
import * as F from '../study/focus.js';
import * as W from './weather-service.js';
import { fmtTime, fmtClock, fmtLongDate, relativeDay, dayPart, msToMinute, ago, dayDiff } from '../core/time.js';

const open = (name) => bus.emit('ui:open', name);
const head = (ic, label, meta) => h('header', { class: 'widget__head' }, h('span', { class: 'eyebrow' }, icon(ic, 14), label), meta ? h('span', { class: 'widget__meta' }, meta) : null);

function hour12Of(opt) { return opt === '12h' ? true : opt === '24h' ? false : prefs.get().hour12; }

export const WIDGETS = [
  {
    id: 'clock', title: 'Clock & date', icon: 'clock', sizes: ['s', 'm'], defaultSize: 's',
    options: [{ key: 'format', label: 'Time format', type: 'choice', choices: [['auto', 'Auto'], ['12h', '12 h'], ['24h', '24 h']], default: 'auto' }, { key: 'date', label: 'Show date', type: 'toggle', default: true }],
    subscribe(cb) {
      let t;
      const tick = () => { cb(); t = setTimeout(tick, msToMinute()); };
      t = setTimeout(tick, msToMinute());
      const vis = () => { if (!document.hidden) cb(); };
      document.addEventListener('visibilitychange', vis);
      return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
    },
    render({ size, opts }) {
      const now = new Date();
      const t = fmtTime(now, hour12Of(opts.format));
      const m = /^(.*?)\s?([AP]M)$/i.exec(t);
      return h('div', { class: `clock clock--${size}` },
        h('div', { class: 'clock__time' }, m ? m[1] : t, m ? h('small', null, m[2]) : null),
        opts.date ? h('div', { class: 'clock__date' }, fmtLongDate(now)) : null,
        size === 'm' ? h('div', { class: 'clock__part muted' }, `Good ${dayPart(now) === 'night' ? 'night' : dayPart(now)}`) : null);
    },
  },
  {
    id: 'weather', title: 'Weather', icon: 'cloud', sizes: ['s', 'm'], defaultSize: 's', opensSheet: 'weather',
    options: [{ key: 'feels', label: 'Show “feels like”', type: 'toggle', default: true }],
    subscribe(cb) {
      const a = weatherStore.subscribe(cb);
      const b = bus.on('weather:status', cb);
      W.refresh();
      const vis = () => { if (!document.hidden) W.refresh(); };
      document.addEventListener('visibilitychange', vis);
      return () => { a(); b(); document.removeEventListener('visibilitychange', vis); };
    },
    render({ size, opts }) {
      const s = weatherStore.get();
      if (!s.loc) {
        return h('div', { class: 'wx wx--empty' }, head('cloud', 'Weather'), h('p', { class: 'muted' }, 'Choose a city to see the weather.'), h('button', { class: 'btn btn--sm', type: 'button', onclick: () => open('weather') }, icon('pin', 15), 'Set location'));
      }
      const d = s.cache?.data;
      const u = s.units === 'f' ? '°F' : '°C';
      if (!d) {
        return h('div', { class: 'wx wx--empty' }, head('cloud', s.loc.name),
          h('p', { class: 'muted' }, W.status.loading ? 'Loading…' : W.status.error || 'No data yet'),
          W.status.loading ? null : h('button', { class: 'btn btn--sm', type: 'button', onclick: () => W.refresh({ force: true }) }, icon('refresh', 15), 'Retry'));
      }
      const g = weatherGlyph(d.code, d.isDay);
      const stale = Date.now() - s.cache.at > 45 * 60000;
      return h('div', { class: `wx wx--${size}` },
        head('pin', s.loc.name, stale ? ago(s.cache.at) : null),
        h('div', { class: 'wx__main' }, h('span', { class: 'wx__icon', 'data-icon': g.icon }, icon(g.icon, size === 'm' ? 40 : 34, { stroke: 1.5 })),
          h('div', null, h('div', { class: 'wx__temp' }, `${d.temp}°`), h('div', { class: 'wx__cond' }, g.label))),
        size === 'm'
          ? h('div', { class: 'wx__stats' },
            d.hi != null ? h('span', null, `H ${d.hi}${u}  L ${d.lo}${u}`) : null,
            d.rain != null ? h('span', null, `Rain ${d.rain}%`) : null,
            opts.feels ? h('span', null, `Feels ${d.feels}°`) : null,
            h('span', null, `Wind ${d.wind}`))
          : (opts.feels ? h('div', { class: 'wx__sub muted' }, `Feels ${d.feels}°`) : null));
    },
  },
  {
    id: 'quick', title: 'Quick actions', icon: 'bolt', sizes: ['m'], defaultSize: 'm',
    subscribe: () => () => {},
    render() {
      const act = (ic, label, fn) => h('button', { class: 'qa', type: 'button', onclick: fn }, h('span', { class: 'qa__ic' }, icon(ic, 20)), h('span', null, label));
      return h('div', { class: 'qa-row' },
        act('calendar', 'Plan my day', () => bus.emit('ui:chat', { text: 'Plan my day', send: true })),
        act('plus', 'Add task', () => open('tasks:add')),
        act('book', 'Study', () => open('study')),
        act('chat', 'Ask', () => bus.emit('ui:chat', { text: '', send: false })));
    },
  },
  {
    id: 'tasks', title: 'Tasks', icon: 'list', sizes: ['m', 'l'], defaultSize: 'm', opensSheet: 'tasks',
    options: [{ key: 'scope', label: 'Show', type: 'choice', choices: [['today', 'Today'], ['open', 'All open']], default: 'today' }, { key: 'done', label: 'Show completed today', type: 'toggle', default: false }],
    subscribe: (cb) => tasksStore.subscribe(cb),
    render({ size, opts }) {
      const now = new Date();
      const s = T.summary(now);
      let items = T.list(opts.scope === 'open' ? 'open' : 'today', now);
      if (opts.scope === 'today') items = [...T.list('overdue', now), ...items];
      if (opts.done) items = [...items, ...T.list('done', now).filter((t) => t.doneAt && new Date(t.doneAt).toDateString() === now.toDateString())];
      const cap = size === 'l' ? 8 : 4;
      const shown = items.slice(0, cap);
      const meta = s.todayTotal ? `${s.doneToday}/${s.todayTotal} today` : s.open ? plural(s.open, 'open task') : '';
      const body = shown.length
        ? h('ul', { class: 'tl' }, ...shown.map((t) => taskRow(t, now)))
        : h('div', { class: 'tl__empty' }, h('p', { class: 'muted' }, s.open ? 'Nothing due today.' : 'No tasks yet.'), h('button', { class: 'btn btn--sm', type: 'button', onclick: () => open('tasks:add') }, icon('plus', 15), 'Add a task'));
      const more = items.length > cap ? h('button', { class: 'tl__more', type: 'button', onclick: () => open('tasks') }, `+${items.length - cap} more`) : null;
      return h('div', { class: 'tasks' }, head('list', 'Tasks', meta), body, more);
    },
  },
  {
    id: 'calendar', title: 'Calendar', icon: 'calendar', sizes: ['s', 'm'], defaultSize: 'm', opensSheet: 'calendar',
    subscribe: (cb) => eventsStore.subscribe(cb),
    render({ size }) {
      const now = new Date();
      const up = E.upcoming(now, size === 'm' ? 3 : 1);
      const body = up.length
        ? h('ul', { class: 'ev' }, ...up.map((e) => h('li', null,
          h('span', { class: 'ev__when' }, relativeDay(e.date, now), e.time ? h('b', null, fmtClock(e.time, prefs.get().hour12)) : null),
          h('span', { class: 'ev__title' }, e.title))))
        : h('div', { class: 'tl__empty' }, h('p', { class: 'muted' }, 'Nothing scheduled.'), h('button', { class: 'btn btn--sm', type: 'button', onclick: () => open('calendar:add') }, icon('plus', 15), 'Add event'));
      return h('div', { class: 'cal' }, head('calendar', 'Calendar', 'on this device'), body);
    },
  },
  {
    id: 'study', title: 'Study progress', icon: 'target', sizes: ['s', 'm'], defaultSize: 'm', opensSheet: 'study',
    subscribe(cb) {
      let iv = null;
      const sync = () => {
        if (F.active() && !iv) iv = setInterval(cb, 1000);
        else if (!F.active() && iv) { clearInterval(iv); iv = null; }
      };
      const un = studyStore.subscribe(() => { sync(); cb(); });
      sync();
      return () => { un(); clearInterval(iv); };
    },
    render({ size }) {
      const now = new Date();
      const f = F.active();
      const t = P.today(now), a = P.accuracy(now), st = P.streak(now);
      if (f) {
        return h('div', { class: 'study' }, head('target', 'Focus', f.label || `${f.minutes} min`),
          h('div', { class: 'study__timer' }, F.fmtRemaining(F.remainingMs())),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => open('study') }, 'Open'));
      }
      if (!P.hasAnyData()) {
        return h('div', { class: 'study' }, head('target', 'Study'), h('p', { class: 'muted' }, 'No sessions logged yet.'), h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => open('study') }, 'Start a session'));
      }
      const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
      const wk = P.week(now);
      const max = Math.max(30, ...wk.map((d) => d.focusMin));
      return h('div', { class: 'study' }, head('target', 'Study', st ? `${st}-day streak` : null),
        h('div', { class: 'stats' }, stat(`${t.focusMin}m`, 'focused today'), stat(a.pct == null ? '–' : `${a.pct}%`, 'accuracy (7d)')),
        size === 'm' ? h('div', { class: 'bars', role: 'img', 'aria-label': 'Focus minutes, last 7 days' }, ...wk.map((d, i) => h('i', { class: i === 6 ? 'is-today' : '', style: { '--h': `${Math.max(6, (d.focusMin / max) * 100)}%` }, title: `${d.focusMin} min` }))) : null);
    },
  },
];

function taskRow(t, now) {
  const due = t.due ? (dayDiff(t.due, now) < 0 && !t.done ? 'Overdue' : relativeDay(t.due, now)) : '';
  return h('li', { class: `tr${t.done ? ' is-done' : ''}` },
    h('button', { class: 'check', type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': `${t.done ? 'Reopen' : 'Complete'} ${t.title}`, onclick: () => T.complete(t.id, !t.done) }, icon('check', 15, { stroke: 3 })),
    h('span', { class: 'tr__title' }, t.title),
    t.time ? h('span', { class: 'tr__due' }, fmtClock(t.time, prefs.get().hour12)) : (due && due !== 'Today' ? h('span', { class: `tr__due${due === 'Overdue' ? ' is-late' : ''}` }, due) : null),
    h('span', { class: 'dot-p', 'data-p': t.priority, title: `${t.priority} priority` }));
}
