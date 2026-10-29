// The conversation card: transcript rendering, scrolling behaviour, empty state and follow-up chips.
import { h, clear, frameThrottle } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { MarkdownView } from './markdown.js';
import { actionCard, confirmCard, quizCard } from './cards.js';
import * as T from '../butler/tasks.js';

const STICK_PX = 90;

export class ChatView {
  /**
   * @param {object} o
   * @param {import('./conversation.js').Conversation} o.conv
   * @param {(text:string, send:boolean)=>void} o.onPrompt   chip pressed: send it, or just prefill the composer
   * @param {()=>void} o.onClose
   * @param {()=>void} o.onOpenSettings
   */
  constructor({ conv, onPrompt, onClose, onOpenSettings }) {
    this.conv = conv;
    this.onPrompt = onPrompt;
    this.onOpenSettings = onOpenSettings;
    this.stick = true;
    this.nodes = new Map();   // message id -> { el, body, md: MarkdownView|null, mdPart }
    this.statusText = '';

    this.statusEl = h('div', { class: 'chat-status', role: 'status', 'aria-live': 'polite' });
    this.studyBtn = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Study mode', title: 'Study mode', onclick: () => conv.setStudyMode(!conv.studyMode) }, icon('book', 19));
    this.newBtn = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'New conversation', title: 'New conversation', onclick: () => conv.clear() }, icon('newChat', 19));
    this.closeBtn = h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Close conversation', title: 'Close', onclick: onClose }, icon('down', 22));
    this.head = h('header', { class: 'chat-head' }, this.statusEl, h('div', { class: 'chat-tools' }, this.studyBtn, this.newBtn, this.closeBtn));

    this.empty = h('div', { class: 'chat-empty' });
    this.list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'off' });
    this.scroll = h('div', { class: 'chat-scroll', tabindex: '-1' }, this.empty, this.list);
    this.jump = h('button', { class: 'jump', type: 'button', hidden: true, 'aria-label': 'Jump to latest', onclick: () => this.toBottom(true) }, icon('arrowDown', 18));
    this.card = h('div', { class: 'chat-card glass glass--strong' }, this.head, this.scroll, this.jump);

    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.renderStream = frameThrottle((id) => this.paintStream(id));
    this.followBottom = frameThrottle(() => { if (this.stick) this.scroll.scrollTop = this.scroll.scrollHeight; });

    conv.on('change', (e) => this.onChange(e));
    conv.on('mode', () => { this.syncMode(); this.renderEmpty(); this.renderFollowups(); });
    conv.on('status', () => { this.syncStatus(); this.renderFollowups(); });
    conv.on('phase', (p) => this.onPhase(p));
    this.rebuild();
    this.syncMode();
  }

  // ---------- status ----------
  setConnected(connected) { this.connected = connected; this.syncStatus(); }

  onPhase(p) {
    const map = { thinking: 'Thinking…', token: 'Writing…', retrying: 'Reconnecting…', confirm: 'Waiting for you…', 'action-ok': 'Working…' };
    if (map[p]) { this.statusText = map[p]; this.statusEl.textContent = this.statusText; }
    if (['done', 'done-happy', 'error', 'stopped'].includes(p)) this.syncStatus();
  }

  syncStatus() {
    this.statusText = this.conv.busy ? this.statusText || 'Thinking…' : this.connected === false ? 'Not connected' : this.conv.studyMode ? 'Study mode' : '';
    this.statusEl.textContent = this.statusText;
    this.statusEl.dataset.tone = this.connected === false && !this.conv.busy ? 'warn' : '';
  }

  syncMode() {
    const on = this.conv.studyMode;
    this.studyBtn.setAttribute('aria-pressed', String(on));
    this.card.dataset.study = on ? '1' : '0';
    this.syncStatus();
  }

  // ---------- scroll ----------
  distance() { return this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight; }

  onScroll() {
    this.stick = this.distance() < STICK_PX;
    this.jump.hidden = this.stick;
  }

  toBottom(force = false) {
    if (force) this.stick = true;
    this.scroll.scrollTop = this.scroll.scrollHeight;
    this.jump.hidden = true;
  }

  // ---------- rendering ----------
  rebuild() {
    clear(this.list);
    this.nodes.clear();
    for (const m of this.conv.messages) this.mount(m);
    this.renderEmpty();
    this.renderFollowups();
    requestAnimationFrame(() => this.toBottom(true));
  }

  onChange(e) {
    if (e.kind === 'reset') { this.rebuild(); return; }
    if (e.kind === 'append') {
      for (const m of this.conv.messages) if (!this.nodes.has(m.id)) this.mount(m);
      const last = this.conv.messages[this.conv.messages.length - 1];
      if (last?.role === 'user') this.stick = true; // sending always follows the conversation
      this.renderEmpty();
    } else if (e.kind === 'update') {
      const m = this.conv.messages.find((x) => x.id === e.id);
      if (m) this.paint(m);
    } else if (e.kind === 'stream') {
      this.renderStream(e.id);
    }
    this.renderFollowups();
    this.followBottom();
  }

  mount(m) {
    const el = h('article', { class: `msg msg--${m.role}`, 'data-id': m.id });
    const body = h('div', { class: 'msg__body' });
    el.append(body);
    this.list.append(el);
    const node = { el, body, md: null, mdIndex: -1, foot: null };
    this.nodes.set(m.id, node);
    this.paint(m);
  }

  paintStream(id) {
    const m = this.conv.messages.find((x) => x.id === id);
    const node = this.nodes.get(id);
    if (!m || !node) return;
    const idx = m.parts.length - 1;
    const part = m.parts[idx];
    // fast path: only the trailing text part changed → incremental markdown update
    if (part?.type === 'text' && node.md && node.mdIndex === idx) {
      node.md.update(part.text);
      this.syncTyping(m, node);
      this.followBottom();
    } else this.paint(m);
  }

  paint(m) {
    const node = this.nodes.get(m.id);
    if (!node) return;
    clear(node.body);
    node.md = null;
    node.mdIndex = -1;
    node.el.dataset.status = m.status;
    m.parts.forEach((p, i) => {
      if (p.type === 'text') {
        if (m.role === 'user') node.body.append(h('div', { class: 'bubble' }, p.text));
        else {
          const wrap = h('div', { class: 'md' });
          const md = new MarkdownView(wrap);
          md.update(p.text);
          node.body.append(wrap);
          if (i === m.parts.length - 1) { node.md = md; node.mdIndex = i; }
        }
      } else if (p.type === 'action') node.body.append(actionCard(p));
      else if (p.type === 'confirm') node.body.append(confirmCard(p, { onDecide: (ok) => this.conv.resolveConfirm(p.id, ok) }));
      else if (p.type === 'quiz') {
        node.body.append(quizCard(p, {
          onAnswer: (qi, oi) => this.conv.answerQuiz(p.id, qi, oi),
          onReview: () => this.onPrompt(reviewPrompt(p), true),
        }));
      } else if (p.type === 'note') node.body.append(h('div', { class: 'msg__note' }, p.text));
    });
    this.syncTyping(m, node);
    if (m.status === 'error' && m.error) node.body.append(this.errorBlock(m));
    if (m.status === 'stopped') node.body.append(h('div', { class: 'msg__note' }, 'Stopped'));
    this.footer(m, node);
  }

  syncTyping(m, node) {
    const last = m.parts[m.parts.length - 1];
    const waiting = m.status === 'streaming' && (!last || (last.type !== 'text' && !(last.type === 'confirm' && last.state === 'pending')));
    const has = node.body.querySelector(':scope > .typing');
    if (waiting && !has) node.body.append(h('div', { class: 'typing', 'aria-label': 'DABSy is thinking' }, h('i'), h('i'), h('i')));
    else if (!waiting && has) has.remove();
  }

  footer(m, node) {
    node.foot?.remove();
    node.foot = null;
    if (m.role !== 'assistant' || m.status === 'streaming') return;
    const text = m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n').trim();
    if (!text) return;
    node.foot = h('div', { class: 'msg__foot' }, h('button', {
      class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Copy answer', title: 'Copy',
      onclick: (e) => {
        const b = e.currentTarget;
        navigator.clipboard?.writeText(text).then(() => { b.replaceChildren(icon('check', 17)); setTimeout(() => b.replaceChildren(icon('copy', 17)), 1300); }, () => {});
      },
    }, icon('copy', 17)));
    node.el.append(node.foot);
  }

  errorBlock(m) {
    const { kind, message } = m.error;
    const hint = {
      config: 'Add your DABSy backend address in Settings to start chatting.',
      network: 'Check your connection and try again.',
      timeout: 'The server took too long to answer.',
    }[kind] || '';
    return h('div', { class: 'msg__error', role: 'alert' },
      h('div', null, h('b', null, message), hint ? h('span', null, ' ' + hint) : null),
      h('div', { class: 'msg__error-btns' },
        kind === 'config'
          ? h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: this.onOpenSettings }, 'Open settings')
          : h('button', { class: 'btn btn--sm', type: 'button', onclick: () => this.conv.retry() }, icon('refresh', 15), 'Try again')));
  }

  // ---------- empty state & follow-ups ----------
  renderEmpty() {
    const has = this.conv.messages.length > 0;
    this.card.dataset.empty = has ? '0' : '1';
    this.empty.hidden = has;
    if (has) return;
    clear(this.empty);
    const study = this.conv.studyMode;
    const s = T.summary();
    const chips = study
      ? [['Explain a topic to me', 'Explain ', false], ['Practice questions', 'Quiz me on ', false], ['Teach me step by step', 'Teach me step by step: ', false]]
      : [['Plan my day', 'Plan my day', true], [s.open ? 'What’s on today?' : 'Add a task', s.open ? 'What’s on my list today?' : 'Add a task: ', s.open], ['Explain something', 'Explain ', false]];
    this.empty.append(
      h('p', { class: 'chat-empty__hi' }, study ? 'Study mode' : 'Hi, I’m DABSy.'),
      h('p', { class: 'chat-empty__sub' }, study ? 'I’ll teach in small steps, quiz you, and check your answers.' : 'Ask me anything, or hand me a task.'),
      h('div', { class: 'chips' }, ...chips.map(([label, text, send]) => h('button', { class: 'chip', type: 'button', onclick: () => this.onPrompt(text, send) }, label))));
  }

  renderFollowups() {
    this.followEl?.remove();
    this.followEl = null;
    const msgs = this.conv.messages;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant' || last.status !== 'done' || this.conv.busy) return;
    const text = last.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
    const hasQuiz = last.parts.some((p) => p.type === 'quiz');
    if (hasQuiz || text.length < (this.conv.studyMode ? 120 : 420)) return;
    const study = this.conv.studyMode;
    const chips = [['Simpler', 'Explain that more simply, with an everyday analogy.'], ['Go deeper', 'Go deeper: how does it actually work, with an example?']];
    if (study) chips.push(['Quiz me', 'Quiz me on that.']);
    this.followEl = h('div', { class: 'chips chips--follow' }, ...chips.map(([label, t]) => h('button', { class: 'chip chip--sm', type: 'button', onclick: () => this.onPrompt(t, true) }, label)));
    this.list.append(this.followEl);
  }
}

function reviewPrompt(p) {
  const { quiz, answers } = p;
  const missed = quiz.questions
    .map((q, i) => ({ q, i, a: answers[i] }))
    .filter((x) => x.a !== x.q.correct)
    .map((x) => `Q${x.i + 1} “${x.q.question}” — I chose “${x.q.options[x.a]}”, correct was “${x.q.options[x.q.correct]}”`);
  const right = quiz.questions.length - missed.length;
  return `I scored ${right}/${quiz.questions.length} on the ${quiz.topic} quiz. Help me understand what I missed, one at a time:\n${missed.join('\n')}`;
}
