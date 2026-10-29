// DABSy V3 — application entry. Wires the character, scene, conversation, widgets and overlays together.
import './styles/index.css';
import { h, $ } from './core/dom.js';
import { bus } from './core/util.js';
import { prefs, runtime, layout, tasks as tasksStore, study as studyStore } from './core/state.js';
import { pushLayer, releaseLayer } from './core/nav.js';
import { dayPart, msToMinute } from './core/time.js';
import { Dabsy } from './character/dabsy.js';
import { Scene, pickScene } from './scenes/scene.js';
import { Conversation } from './chat/conversation.js';
import { ChatView } from './chat/chat-view.js';
import { Composer } from './chat/composer.js';
import { WidgetBoard } from './widgets/board.js';
import { initOverlays, sheetOpen, toast } from './ui/sheet.js';
import { icon } from './ui/icons.js';
import { tasksSheet, calendarSheet, studySheet, weatherSheet, customizeSheet, settingsSheet } from './ui/sheets.js';
import { normalizeApiUrl } from './ai/client.js';
import * as T from './butler/tasks.js';
import * as F from './study/focus.js';

async function loadConfig() {
  let fileUrl = '';
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) fileUrl = (await res.json()).apiUrl || '';
  } catch { /* offline or missing: fall back to prefs only */ }
  const resolve = () => { runtime.apiUrl = normalizeApiUrl(prefs.get().apiUrl) || normalizeApiUrl(fileUrl) || ''; };
  resolve();
  return resolve;
}

function detectPerf() {
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  if (weak) document.documentElement.dataset.perf = 'lite';
}

async function boot() {
  detectPerf();
  const app = $('#app');
  const resolveConfig = await loadConfig();

  // ---------- DOM shell ----------
  const sceneRoot = h('div', { class: 'scene', 'aria-hidden': 'true' });
  const widgetGrid = h('div', { class: 'widget-grid' });
  const settingsBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onclick: () => settingsSheet() }, icon('sliders', 22));
  const anchorHome = h('div', { class: 'anchor anchor--home' });
  const whisper = h('button', { class: 'whisper glass', type: 'button' });
  const homeView = h('main', { class: 'view view--home' },
    h('header', { class: 'topbar' }, h('span', { class: 'wordmark' }, 'DABSy'), settingsBtn),
    h('div', { class: 'stage' }, anchorHome, whisper),
    h('div', { class: 'widgets' }, widgetGrid,
      h('button', { class: 'btn btn--quiet customize', type: 'button', onclick: () => customizeSheet() }, icon('sliders', 16), 'Customize widgets')));
  const anchorChat = h('div', { class: 'anchor anchor--chat' });
  const chatEl = h('section', { class: 'view view--chat', 'aria-label': 'Conversation', 'aria-hidden': 'true' }, anchorChat);
  const dabsyLayer = h('div', { class: 'dabsy-layer' });
  const dock = h('footer', { class: 'dock' });
  const sheetRoot = h('div', { class: 'sheet-root' });
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  const bootVeil = h('div', { class: 'boot' });
  app.append(sceneRoot, h('div', { class: 'scrim', 'aria-hidden': 'true' }), homeView, chatEl, dabsyLayer, dock, sheetRoot, toasts, bootVeil);
  chatEl.inert = true;
  initOverlays(sheetRoot, toasts);

  // ---------- subsystems ----------
  const isReduced = () => prefs.get().motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new Scene(sceneRoot);
  const dabsy = new Dabsy(dabsyLayer, { isReduced });
  const conv = new Conversation();
  const board = new WidgetBoard(widgetGrid);
  const composer = new Composer({
    onSubmit: (text) => submit(text),
    onStop: () => conv.stop(),
    onFocus: () => { if (view === 'home') openChat(); if (!conv.busy) dabsy.set('listening'); },
    onBlur: () => { if (!conv.busy) dabsy.set('idle'); },
  });
  dock.append(composer.el);
  const chatView = new ChatView({
    conv, onClose: () => closeChat(), onOpenSettings: () => settingsSheet(),
    onPrompt: (text, send) => (send ? submit(text) : composer.setValue(text)),
  });
  chatEl.append(chatView.card);

  let view = 'home';
  let layer = null;
  const anchorFor = (v) => (v === 'chat' ? anchorChat : anchorHome);

  // ---------- layout plumbing ----------
  const syncDock = () => app.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  new ResizeObserver(() => { syncDock(); dabsy.snap(anchorFor(view)); }).observe(dock);
  new ResizeObserver(() => dabsy.snap(anchorFor(view))).observe(app);
  const syncViewport = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const shrunk = window.innerHeight - vv.height > 80;
    if (shrunk && matchMedia('(pointer: coarse)').matches) { app.style.setProperty('--vvh', `${vv.height}px`); app.style.transform = `translateY(${vv.offsetTop}px)`; }
    else { app.style.removeProperty('--vvh'); app.style.transform = ''; }
    dabsy.snap(anchorFor(view));
    if (chatView.stick) chatView.toBottom();
  };
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
  addEventListener('resize', () => dabsy.snap(anchorFor(view)));

  // ---------- view switching ----------
  function openChat() {
    if (view === 'chat') return;
    view = 'chat';
    app.dataset.view = 'chat';
    chatEl.inert = false;
    chatEl.removeAttribute('aria-hidden');
    homeView.inert = true;
    layer = pushLayer(({ fromHistory }) => closeChat({ fromHistory }));
    dabsy.flyTo(anchorChat, 'flying');
    requestAnimationFrame(() => chatView.toBottom(true));
    syncPlaceholder();
  }

  function closeChat({ fromHistory = false } = {}) {
    if (view !== 'chat') return;
    view = 'home';
    if (layer && !fromHistory) releaseLayer(layer);
    layer = null;
    app.dataset.view = 'home';
    chatEl.inert = true;
    chatEl.setAttribute('aria-hidden', 'true');
    homeView.inert = false;
    composer.input.blur();
    dabsy.flyTo(anchorHome, 'returning');
    syncPlaceholder();
  }

  function submit(text) {
    if (view === 'home') openChat();
    chatView.stick = true;
    conv.send(text);
  }

  function syncPlaceholder() {
    composer.setPlaceholder(view === 'home' ? 'Ask DABSy anything…' : conv.studyMode ? 'Ask about what you’re studying…' : 'Message DABSy…');
  }

  // ---------- conversation → character & UI ----------
  conv.on('status', ({ busy }) => composer.setBusy(busy));
  conv.on('change', (e) => { if (e.kind === 'stream') dabsy.pulse(); });
  conv.on('mode', () => { app.dataset.study = conv.studyMode ? '1' : '0'; updateScene(); syncPlaceholder(); });
  conv.on('phase', (p) => {
    switch (p) {
      case 'thinking': case 'retrying': dabsy.set('thinking'); break;
      case 'token': dabsy.set('answering'); break;
      case 'confirm': dabsy.set('listening'); break;
      case 'done': dabsy.set(document.activeElement === composer.input ? 'listening' : 'idle'); break;
      case 'done-happy': case 'quiz-done': dabsy.set('idle'); dabsy.react('happy', 1500); break;
      case 'quiz-right': dabsy.react('happy', 900); break;
      case 'error': dabsy.set('idle'); dabsy.react('confused', 1900); break;
      case 'stopped': dabsy.set('idle'); break;
      default: break;
    }
  });

  // ---------- intents from widgets / sheets ----------
  bus.on('ui:open', (name) => {
    const [which, mode] = String(name).split(':');
    const opts = { focusAdd: mode === 'add' };
    ({ tasks: tasksSheet, calendar: calendarSheet, study: studySheet, weather: weatherSheet, settings: settingsSheet, customize: customizeSheet }[which] || (() => {}))(opts);
  });
  bus.on('ui:chat', ({ text = '', send = false, study } = {}) => {
    if (study === true) conv.setStudyMode(true);
    openChat();
    if (send && text) submit(text); else if (text) composer.setValue(text); else composer.focus();
  });
  bus.on('chat:reset', () => conv.clear());
  bus.on('config:changed', () => { resolveConfig(); chatView.setConnected(!!runtime.apiUrl); updateScene(); updateWhisper(); });

  // ---------- scene ----------
  function updateScene() {
    scene.show(pickScene({ pref: prefs.get().scene, study: conv.studyMode }));
  }
  prefs.subscribe(() => { app.dataset.motion = prefs.get().motion; updateScene(); resolveConfig(); chatView.setConnected(!!runtime.apiUrl); });
  app.dataset.motion = prefs.get().motion;
  app.dataset.study = conv.studyMode ? '1' : '0';
  chatView.setConnected(!!runtime.apiUrl);
  updateScene();
  setInterval(updateScene, 60000);

  // ---------- whisper ----------
  function updateWhisper() {
    const now = new Date();
    const s = T.summary(now);
    const part = dayPart(now);
    let line = `Good ${part}`;
    if (F.active()) line = 'Focus session running';
    else if (s.overdue) line += ` · ${s.overdue} overdue`;
    else if (s.today) line += ` · ${s.today} to do today`;
    else if (s.todayTotal && s.doneToday) line = 'All done for today';
    whisper.textContent = line;
  }
  whisper.addEventListener('click', () => openChat());
  tasksStore.subscribe(updateWhisper);
  studyStore.subscribe(updateWhisper);
  updateWhisper();
  (function minute() { setTimeout(() => { updateWhisper(); minute(); }, msToMinute()); })();

  // ---------- focus sessions ----------
  const announce = (f) => {
    toast(`Focus session complete · ${f.minutes} min`);
    dabsy.react('happy', 1600);
    try { navigator.vibrate?.([80, 60, 80]); } catch { /* unsupported */ }
  };
  bus.on('focus:done', announce);
  const done = F.finalizeIfDue();
  if (done) setTimeout(() => announce(done), 800);
  F.arm();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { F.finalizeIfDue(); F.arm(); updateScene(); } });

  // ---------- character interactions ----------
  dabsy.el.addEventListener('click', () => { if (view === 'home') openChat(); else dabsy.react('happy', 1100); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && view === 'chat' && !sheetOpen()) closeChat(); });

  // ---------- go ----------
  syncDock();
  dabsy.snap(anchorHome);
  await dabsy.ready();
  dabsy.snap(anchorHome);
  bootVeil.classList.add('is-done');
  setTimeout(() => bootVeil.remove(), 500);
  delete app.dataset.boot;

  if (new URLSearchParams(location.search).has('e2e')) window.__dabsy = { conv, dabsy, board, scene, prefs, layout, composer, chatView, openChat, closeChat };

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is a bonus, never a blocker */ });
  }
}

boot().catch((e) => {
  console.error('DABSy failed to start', e);
  document.getElementById('app')?.append(h('p', { style: { padding: '24px', color: '#fff' } }, 'DABSy couldn’t start. Try reloading.'));
});

