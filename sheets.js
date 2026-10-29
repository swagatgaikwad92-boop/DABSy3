// The app's sheets: Tasks, Calendar, Study, Weather, Customize widgets, Settings.
import { h } from '../core/dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './sheet.js';
import { segmented, toggle } from './controls.js';
import { bus } from '../core/util.js';
import { prefs, layout, weather as weatherStore, tasks as tasksStore, events as eventsStore, study as studyStore, runtime } from '../core/state.js';
import { eraseEverything } from '../core/storage.js';
import * as T from '../butler/tasks.js';
import * as E from '../butler/events.js';
import * as P from '../study/progress.js';
import * as F from '../study/focus.js';
import * as W from '../widgets/weather-service.js';
import { WIDGETS } from '../widgets/defs.js';
import { resolveLayout, moveWidget } from '../widgets/registry.js';
import { normalizeApiUrl, testConnection } from '../ai/client.js';
import { SCENES, SCENE_LABELS } from '../scenes/scene.js';
import { isoDate, relativeDay, fmtClock, dayDiff } from '../core/time.js';

const PRIO_NEXT = { normal: 'high', high: 'low', low: 'normal' };
const PRIO_LABEL = { high: 'High', normal: 'Normal', low: 'Low' };

/** Re-run `fn` when stores change, unless the user is typing inside `el`. Returns an unsubscribe. */
function live(el, stores, fn) {
  let pending = false;
  const run = () => {
    if (el.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.dataset.live !== '1') { pending = true; return; }
    pending = false; fn();
  };
  const offs = stores.map((s) => s.subscribe(run));
  el.addEventListener('focusout', () => { if (pending) setTimeout(run, 0); });
  return () => offs.forEach((o) => o());
}

// =============================== TASKS ===============================
export function tasksSheet({ focusAdd = false } = {}) {
  let off = () => {};
  let addDue = 'today', addPrio = 'normal';
  openSheet({
    title: 'Tasks',
    onClose: () => off(),
    render(body, api) {
      const input = h('input', { class: 'input', placeholder: 'Add a task…', maxlength: '140', enterkeyhint: 'done', 'aria-label': 'New task', 'data-live': '1' });
      const add = () => {
        const r = T.create({ title: input.value, due: addDue === 'none' ? null : addDue, priority: addPrio });
        if (!r.ok) { toast(r.error, { tone: 'bad' }); return; }
        if (r.existed) toast('That’s already on your list');
        input.value = '';
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const form = h('div', { class: 'stack' },
        h('div', { class: 'row' }, input, h('button', { class: 'btn btn--primary', type: 'button', onclick: add, 'aria-label': 'Add task' }, icon('plus', 18, { stroke: 2.4 }))),
        h('div', { class: 'row row--wrap' },
          segmented([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['none', 'No date']], addDue, (v) => { addDue = v; }, 'Due'),
          segmented([['high', 'High'], ['normal', 'Normal'], ['low', 'Low']], addPrio, (v) => { addPrio = v; }, 'Priority')));
      const list = h('div', { class: 'tsk-list' });
      body.append(form, list);

      const draw = () => {
        const now = new Date();
        const open = T.list('open', now), done = T.list('done', now).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
        const today = isoDate(now);
        const groups = [
          ['Overdue', open.filter((t) => t.due && t.due < today)],
          ['Today', open.filter((t) => t.due === today)],
          ['Upcoming', open.filter((t) => t.due && t.due > today)],
          ['No date', open.filter((t) => !t.due)],
        ].filter(([, a]) => a.length);
        list.replaceChildren();
        if (!groups.length && !done.length) list.append(h('p', { class: 'muted empty' }, 'No tasks yet. Add one above, or ask DABSy to plan your day.'));
        for (const [name, items] of groups) list.append(h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, `${name} · ${items.length}`), h('ul', { class: 'tsk' }, ...items.map(row))));
        if (done.length) {
          list.append(h('section', { class: 'section' },
            h('div', { class: 'row row--between' }, h('span', { class: 'eyebrow' }, `Done · ${done.length}`), h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: () => { const r = T.clearCompleted(); toast(`Cleared ${r.removed} completed`); } }, 'Clear')),
            h('ul', { class: 'tsk' }, ...done.slice(0, 15).map(row))));
        }
      };

      const row = (t) => {
        const title = h('button', { class: 'tsk__title', type: 'button', onclick: () => edit() }, t.title);
        const edit = () => {
          const inp = h('input', { class: 'input input--inline', value: t.title, maxlength: '140', 'aria-label': 'Task title' });
          const save = () => { const v = inp.value.trim(); if (v && v !== t.title) T.rename(t.id, v); else draw(); };
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = t.title; inp.blur(); } });
          inp.addEventListener('blur', save);
          title.replaceWith(inp);
          inp.focus();
        };
        const dateIn = h('input', { type: 'date', class: 'tsk__date', value: t.due || '', 'aria-label': 'Due date', onchange: (e) => T.move(t.id, { due: e.target.value || null }) });
        const meta = t.due ? (dayDiff(t.due, new Date()) < 0 && !t.done ? 'Overdue' : relativeDay(t.due)) : 'No date';
        return h('li', { class: `tsk__row${t.done ? ' is-done' : ''}` },
          h('button', { class: 'check', type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': `${t.done ? 'Reopen' : 'Complete'} ${t.title}`, onclick: () => T.complete(t.id, !t.done) }, icon('check', 15, { stroke: 3 })),
          h('div', { class: 'tsk__main' }, title,
            h('div', { class: 'tsk__meta' },
              h('label', { class: `pill${meta === 'Overdue' ? ' is-late' : ''}` }, icon('calendar', 13), meta, t.time ? ` · ${fmtClock(t.time, prefs.get().hour12)}` : '', dateIn),
              h('button', { class: 'pill', type: 'button', 'aria-label': `Priority ${PRIO_LABEL[t.priority]}, tap to change`, onclick: () => T.setPriority(t.id, PRIO_NEXT[t.priority]) }, h('span', { class: 'dot-p', 'data-p': t.priority }), PRIO_LABEL[t.priority]))),
          h('button', {
            class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `Delete ${t.title}`,
            onclick: () => { const r = T.remove(t.id); if (r.ok) toast('Task deleted', { action: { label: 'Undo', run: () => T.restore(r.task) } }); },
          }, icon('trash', 18)));
      };
      draw();
      off = live(body, [tasksStore], draw);
      if (focusAdd) setTimeout(() => input.focus(), 380);
    },
  });
}

// =============================== CALENDAR ===============================
export function calendarSheet({ focusAdd = false } = {}) {
  let off = () => {};
  openSheet({
    title: 'Calendar',
    onClose: () => off(),
    render(body) {
      const title = h('input', { class: 'input', placeholder: 'Event title', maxlength: '120', 'aria-label': 'Event title', 'data-live': '1' });
      const date = h('input', { class: 'input', type: 'date', value: isoDate(), 'aria-label': 'Date', 'data-live': '1' });
      const time = h('input', { class: 'input', type: 'time', 'aria-label': 'Time (optional)', 'data-live': '1' });
      const add = () => {
        const r = E.create({ title: title.value, date: date.value, time: time.value || null });
        if (!r.ok) { toast(r.error, { tone: 'bad' }); return; }
        title.value = ''; time.value = '';
        toast(r.existed ? 'Already on your calendar' : 'Event added');
      };
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const list = h('div');
      body.append(
        h('div', { class: 'stack' }, title, h('div', { class: 'row' }, date, time, h('button', { class: 'btn btn--primary', type: 'button', onclick: add, 'aria-label': 'Add event' }, icon('plus', 18, { stroke: 2.4 })))),
        h('p', { class: 'muted note' }, 'Events are stored on this device only — there is no external calendar sync yet.'),
        list);
      const draw = () => {
        const now = new Date();
        const up = E.upcoming(now);
        list.replaceChildren();
        if (!up.length) { list.append(h('p', { class: 'muted empty' }, 'Nothing scheduled.')); return; }
        const byDay = new Map();
        for (const e of up) byDay.set(e.date, [...(byDay.get(e.date) || []), e]);
        for (const [d, items] of byDay) {
          list.append(h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, relativeDay(d, now)),
            h('ul', { class: 'tsk' }, ...items.map((e) => h('li', { class: 'tsk__row' },
              h('span', { class: 'ev__time' }, e.time ? fmtClock(e.time, prefs.get().hour12) : 'All day'),
              h('div', { class: 'tsk__main' }, h('span', { class: 'tsk__title' }, e.title)),
              h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `Delete ${e.title}`, onclick: () => { const r = E.remove(e.id); if (r.ok) toast('Event deleted', { action: { label: 'Undo', run: () => E.restore(r.event) } }); } }, icon('trash', 18)))))));
        }
      };
      draw();
      off = live(body, [eventsStore], draw);
      if (focusAdd) setTimeout(() => title.focus(), 380);
    },
  });
}

// =============================== STUDY ===============================
export function studySheet() {
  let tick = () => {};
  let offLive = () => {};
  let minutes = 25;
  openSheet({
    title: 'Study',
    onClose: () => { tick(); offLive(); },
    render(body, api) {
      const root = h('div');
      body.append(root);
      const draw = () => {
        const now = new Date();
        const f = F.active();
        tick();
        tick = () => {};
        root.replaceChildren();

        // focus
        const focusSec = h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Focus session'));
        if (f) {
          const t = h('div', { class: 'big-timer', role: 'timer' }, F.fmtRemaining(F.remainingMs()));
          focusSec.append(t, h('p', { class: 'muted' }, f.label || `${f.minutes}-minute session`),
            h('button', { class: 'btn btn--danger', type: 'button', onclick: () => { const r = F.stop(); toast(r.spent ? `Logged ${r.spent} min` : 'Session ended'); } }, 'End session'));
          const iv = setInterval(() => { if (!F.active()) { clearInterval(iv); return; } t.textContent = F.fmtRemaining(F.remainingMs()); }, 1000);
          tick = () => clearInterval(iv);
        } else {
          const label = h('input', { class: 'input', placeholder: 'What are you studying? (optional)', maxlength: '80', value: studyStore.get().lastTopic || '', 'aria-label': 'Focus label', 'data-live': '1' });
          focusSec.append(
            segmented([['15', '15 min'], ['25', '25 min'], ['45', '45 min'], ['60', '60 min']], String(minutes), (v) => { minutes = +v; }, 'Length'),
            label,
            h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { const r = F.start(minutes, label.value); if (!r.ok) toast(r.error, { tone: 'bad' }); } }, icon('play', 16), 'Start focus'));
        }
        root.append(focusSec);

        // progress
        const t = P.today(now), a = P.accuracy(now), st = P.streak(now), wk = P.week(now);
        const max = Math.max(30, ...wk.map((d) => d.focusMin));
        root.append(h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Progress'),
          P.hasAnyData()
            ? h('div', null,
              h('div', { class: 'stats stats--3' }, tile(`${t.focusMin}m`, 'focused today'), tile(a.pct == null ? '–' : `${a.pct}%`, `accuracy · ${a.answered} answers`), tile(String(st), st === 1 ? 'day streak' : 'day streak')),
              h('div', { class: 'bars bars--lg', role: 'img', 'aria-label': 'Focus minutes, last 7 days' }, ...wk.map((d, i) => h('div', { class: 'bars__col' }, h('i', { class: i === 6 ? 'is-today' : '', style: { '--h': `${Math.max(6, (d.focusMin / max) * 100)}%` } }), h('span', null, new Date(d.iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'narrow' }))))))
            : h('p', { class: 'muted' }, 'Finish a focus session or answer a practice quiz and your progress shows up here.')));

        // learn
        const topic = h('input', { class: 'input', placeholder: 'Topic, e.g. photosynthesis', maxlength: '120', 'aria-label': 'Topic', 'data-live': '1' });
        const go = (tpl) => {
          const tp = topic.value.trim();
          if (!tp) { topic.focus(); toast('Type a topic first'); return; }
          studyStore.set({ lastTopic: tp });
          api.close();
          bus.emit('ui:chat', { text: tpl(tp), send: true, study: true });
        };
        root.append(h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Learn with DABSy'), topic,
          h('div', { class: 'chips' },
            h('button', { class: 'chip', type: 'button', onclick: () => go((x) => `Teach me ${x}, step by step.`) }, 'Explain'),
            h('button', { class: 'chip', type: 'button', onclick: () => go((x) => `Explain ${x} in the simplest possible way, with an everyday analogy.`) }, 'Simplify'),
            h('button', { class: 'chip', type: 'button', onclick: () => go((x) => `Go deeper on ${x}: the mechanism, common misconceptions, and a worked example.`) }, 'Go deeper'),
            h('button', { class: 'chip chip--on', type: 'button', onclick: () => go((x) => `Quiz me on ${x}.`) }, 'Practice me'))));
      };
      draw();
      offLive = live(body, [studyStore], draw);
    },
  });
}
const tile = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));

// =============================== WEATHER ===============================
export function weatherSheet() {
  openSheet({
    title: 'Weather',
    render(body, api) {
      const s = weatherStore.get();
      const q = h('input', { class: 'input', placeholder: 'Search a city', 'aria-label': 'City', enterkeyhint: 'search', 'data-live': '1' });
      const results = h('ul', { class: 'tsk' });
      const msg = h('p', { class: 'muted note' });
      const pick = async (loc) => { await W.setLocation(loc); toast(`Weather set to ${loc.short || loc.name}`); api.close(); };
      const search = async () => {
        msg.textContent = 'Searching…'; results.replaceChildren();
        try {
          const found = await W.searchCity(q.value);
          msg.textContent = found.length ? '' : 'No matches.';
          for (const r of found) results.append(h('li', { class: 'tsk__row' }, h('button', { class: 'tsk__title', type: 'button', onclick: () => pick(r) }, r.name)));
        } catch { msg.textContent = 'Search failed — check your connection.'; }
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
      body.append(
        h('div', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Location'),
          h('p', null, s.loc ? s.loc.name : 'Not set'),
          h('div', { class: 'row' }, q, h('button', { class: 'btn', type: 'button', onclick: search, 'aria-label': 'Search' }, icon('search', 18))),
          msg, results,
          h('button', { class: 'btn', type: 'button', onclick: async () => { try { await pick(await W.locate()); } catch (e) { toast(e.message, { tone: 'bad' }); } } }, icon('pin', 16), 'Use my location')),
        h('div', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Units'), segmented([['c', '°C'], ['f', '°F']], s.units, (v) => W.setUnits(v), 'Units')),
        h('p', { class: 'muted note' }, 'Weather by Open-Meteo. Your location is only sent to Open-Meteo to fetch the forecast.'));
    },
  });
}

// =============================== CUSTOMIZE WIDGETS ===============================
export function customizeSheet() {
  let off = () => {};
  openSheet({
    title: 'Widgets',
    onClose: () => off(),
    render(body) {
      const list = h('div', { class: 'stack' });
      body.append(h('p', { class: 'muted note' }, 'Show, hide and reorder your widgets, and choose what each one displays.'), list,
        h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => layout.reset() }, icon('undo', 16), 'Reset to default'));
      const draw = () => {
        const items = resolveLayout(WIDGETS, layout.get());
        list.replaceChildren(...items.map((it, i) => {
          const order = items.map((x) => x.id);
          const setOpt = (k, v) => layout.set((s) => ({ ...s, opts: { ...s.opts, [it.id]: { ...(s.opts[it.id] || {}), [k]: v } } }));
          return h('div', { class: `wrow glass${it.visible ? '' : ' is-off'}` },
            h('div', { class: 'row row--between' },
              h('span', { class: 'wrow__name' }, icon(it.def.icon, 18), it.def.title),
              toggle(it.visible, (v) => layout.set((s) => ({ ...s, hidden: v ? s.hidden.filter((x) => x !== it.id) : [...new Set([...s.hidden, it.id])] })), `Show ${it.def.title}`)),
            it.visible ? h('div', { class: 'wrow__ctl' },
              h('div', { class: 'row' },
                h('button', { class: 'icon-btn icon-btn--sm', type: 'button', disabled: i === 0, 'aria-label': `Move ${it.def.title} up`, onclick: () => layout.set((s) => ({ ...s, order: moveWidget(order, it.id, -1) })) }, icon('up', 18)),
                h('button', { class: 'icon-btn icon-btn--sm', type: 'button', disabled: i === items.length - 1, 'aria-label': `Move ${it.def.title} down`, onclick: () => layout.set((s) => ({ ...s, order: moveWidget(order, it.id, 1) })) }, icon('down', 18)),
                it.def.sizes.length > 1 ? segmented(it.def.sizes.map((z) => [z, { s: 'Small', m: 'Wide', l: 'Tall' }[z] || z]), it.size, (v) => layout.set((s) => ({ ...s, sizes: { ...s.sizes, [it.id]: v } })), 'Size') : null),
              ...(it.def.options || []).map((o) => h('div', { class: 'row row--between' }, h('span', { class: 'muted' }, o.label),
                o.type === 'toggle' ? toggle(it.opts[o.key], (v) => setOpt(o.key, v), o.label) : segmented(o.choices, it.opts[o.key], (v) => setOpt(o.key, v), o.label)))) : null);
        }));
      };
      draw();
      // layout changes redraw this list (focus is on buttons, not text inputs, so live() won't defer)
      off = live(body, [layout], draw);
    },
  });
}

// =============================== SETTINGS ===============================
export function settingsSheet() {
  openSheet({
    title: 'Settings',
    render(body, api) {
      const p = prefs.get();
      const sceneBtns = [['auto', 'Auto'], ...SCENES.map((s) => [s, SCENE_LABELS[s]])];
      const url = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://dabsy-api.your-name.workers.dev', value: p.apiUrl, 'aria-label': 'Backend address', autocapitalize: 'off', spellcheck: 'false', 'data-live': '1' });
      const status = h('p', { class: 'muted note', role: 'status' }, runtime.apiUrl ? `Using ${runtime.apiUrl}` : 'No backend configured — chat needs one.');
      const saveUrl = () => {
        const v = url.value.trim();
        if (v && !normalizeApiUrl(v)) { status.textContent = 'Use an https:// address (http:// works only for localhost / local network).'; return false; }
        prefs.set({ apiUrl: v ? normalizeApiUrl(v) : '' });
        bus.emit('config:changed');
        return true;
      };
      let confirmErase = false;
      const erase = h('button', { class: 'btn btn--danger', type: 'button', onclick: () => {
        if (!confirmErase) { confirmErase = true; erase.textContent = 'Tap again to erase everything'; setTimeout(() => { confirmErase = false; erase.textContent = 'Erase all data'; }, 4000); return; }
        eraseEverything(); bus.emit('chat:reset'); bus.emit('config:changed'); toast('All local data erased'); api.close();
      } }, 'Erase all data');

      body.append(
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Scene'),
          h('div', { class: 'scenes' }, ...sceneBtns.map(([v, label]) => h('button', { class: 'scenebtn', type: 'button', 'aria-pressed': String(p.scene === v), onclick: (e) => { prefs.set({ scene: v }); e.currentTarget.parentElement.querySelectorAll('.scenebtn').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } },
            v === 'auto' ? h('span', { class: 'scenebtn__auto' }, icon('sparkle', 22)) : h('img', { src: `./assets/scenes/${v}-day.webp`, alt: '', loading: 'lazy' }), h('span', null, label))))),
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Answer style'),
          segmented([['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']], p.style, (v) => prefs.set({ style: v }), 'Answer style')),
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Motion'),
          segmented([['auto', 'Follow device'], ['reduced', 'Reduce motion']], p.motion, (v) => prefs.set({ motion: v }), 'Motion')),
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'AI connection'), url,
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: async () => { if (!saveUrl()) return; status.textContent = 'Testing…'; const r = await testConnection(url.value || runtime.apiUrl); status.textContent = r.message; status.dataset.tone = r.ok ? 'ok' : 'bad'; } }, 'Save & test'),
            h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => { url.value = ''; saveUrl(); status.textContent = 'Override cleared.'; } }, 'Reset')),
          status,
          h('p', { class: 'muted note' }, 'Your AI key stays on the server (a Cloudflare Worker secret) — it is never stored in this app.')),
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Widgets'), h('button', { class: 'btn', type: 'button', onclick: () => { api.close({ instant: true }); customizeSheet(); } }, icon('sliders', 16), 'Customize widgets')),
        h('section', { class: 'section' }, h('span', { class: 'eyebrow' }, 'Data'),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { bus.emit('chat:reset'); toast('Conversation cleared'); } }, 'Clear conversation'), erase),
          h('p', { class: 'muted note' }, 'Everything — tasks, events, progress, chats — is stored on this device only.')),
        h('p', { class: 'muted note about' }, 'DABSy V3 · native Android home-screen widgets are not included; widgets live inside the app.'));
    },
  });
}
