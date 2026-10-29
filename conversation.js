// Conversation controller: owns the transcript, talks to the AI client, runs the tool loop, and reports phases so the
// character can react. It never fakes anything: text shown is text received, "done" cards come from real tool results.
import { chat as store, runtime, prefs } from '../core/state.js';
import { streamChat, AIError } from '../ai/client.js';
import { buildSystem } from '../ai/prompts.js';
import { trimContext, repairToolPairs, isValidStart } from '../ai/context.js';
import { TOOLS, precheck, execute } from '../butler/tools.js';
import * as T from '../butler/tasks.js';
import * as E from '../butler/events.js';
import * as Study from '../study/progress.js';
import { uid, createEmitter } from '../core/util.js';

const MAX_ROUNDS = 6;
const MAX_VIEW = 80;
const MAX_API = 60;
const MAX_INPUT = 4000;

export class Conversation {
  constructor({ fetchImpl } = {}) {
    this.fetchImpl = fetchImpl;
    this.emitter = createEmitter();
    this.on = this.emitter.on;
    this.abortCtl = null;
    this.waiters = new Map();   // confirm part id -> resolve(decision)
    this.busy = false;

    const s = store.get();
    this.api = repairToolPairs(Array.isArray(s.api) ? s.api : []);
    this.view = (Array.isArray(s.view) ? s.view : []).map(sanitizeRestored);
  }

  get studyMode() { return !!store.get().studyMode; }
  get messages() { return this.view; }

  setStudyMode(on) {
    store.set({ studyMode: !!on });
    this.emitter.emit('mode', !!on);
  }

  // ---------- public actions ----------
  async send(raw) {
    const text = String(raw ?? '').trim().slice(0, MAX_INPUT);
    if (!text || this.busy) return false;
    const now = Date.now();
    this.view.push({ id: uid('m_'), role: 'user', parts: [{ type: 'text', text }], status: 'done', ts: now });
    this.api.push({ role: 'user', content: text });
    this.emitter.emit('change', { kind: 'append' });
    this.persist();
    const msg = this.newAssistant();
    await this.run(msg);
    return true;
  }

  stop() {
    if (!this.busy) return;
    this.abortCtl?.abort();
    for (const [, res] of this.waiters) res('cancelled');
  }

  /** Re-run the last failed assistant turn without duplicating the user message. */
  async retry() {
    if (this.busy) return;
    const last = this.view[this.view.length - 1];
    if (!last || last.role !== 'assistant' || last.status !== 'error') return;
    if (typeof last.retryFrom === 'number') last.parts.length = Math.min(last.parts.length, last.retryFrom);
    last.status = 'streaming';
    last.error = null;
    this.emitter.emit('change', { kind: 'update', id: last.id });
    await this.run(last);
  }

  clear() {
    this.stop();
    this.api = [];
    this.view = [];
    this.busy = false;
    this.persist(true);
    this.emitter.emit('change', { kind: 'reset' });
  }

  resolveConfirm(partId, accepted) {
    const res = this.waiters.get(partId);
    if (res) res(accepted ? 'accepted' : 'declined');
  }

  /** Record one quiz answer. Returns { correct } or null when invalid/already answered. */
  answerQuiz(partId, qIndex, optionIndex) {
    for (const m of this.view) {
      const part = m.parts.find((p) => p.type === 'quiz' && p.id === partId);
      if (!part) continue;
      const q = part.quiz.questions[qIndex];
      if (!q || part.answers[qIndex] != null || optionIndex < 0 || optionIndex >= q.options.length) return null;
      part.answers[qIndex] = optionIndex;
      const correct = optionIndex === q.correct;
      Study.logAnswers(1, correct ? 1 : 0);
      part.done = part.answers.every((a) => a != null);
      this.persist();
      this.emitter.emit('change', { kind: 'update', id: m.id });
      this.emitter.emit('phase', part.done ? 'quiz-done' : correct ? 'quiz-right' : 'quiz-wrong');
      return { correct };
    }
    return null;
  }

  // ---------- internals ----------
  newAssistant() {
    const msg = { id: uid('m_'), role: 'assistant', parts: [], status: 'streaming', error: null, ts: Date.now() };
    this.view.push(msg);
    this.emitter.emit('change', { kind: 'append' });
    return msg;
  }

  setStatus(msg, status, error = null) {
    msg.status = status;
    msg.error = error;
    this.emitter.emit('change', { kind: 'update', id: msg.id });
  }

  async run(msg) {
    this.busy = true;
    this.abortCtl = new AbortController();
    const signal = this.abortCtl.signal;
    this.emitter.emit('status', { busy: true });
    this.emitter.emit('phase', 'thinking');

    let okActions = 0;
    let roundText = '';
    try {
      if (!runtime.apiUrl) throw new AIError('config', 'DABSy is not connected to an AI backend yet.');
      for (let round = 0; round < MAX_ROUNDS; round++) {
        msg.retryFrom = msg.parts.length;
        roundText = '';
        const { text, calls, stop } = await this.streamRound(msg, signal, (t) => { roundText = t; });
        if (stop === 'max_tokens') msg.parts.push({ type: 'note', text: 'That answer hit the length limit — say “continue” to keep going.' });

        if (!calls.length) {
          if (text.trim()) this.api.push({ role: 'assistant', content: text });
          break;
        }
        // assistant turn with tool calls
        const blocks = [];
        if (text.trim()) blocks.push({ type: 'text', text });
        for (const c of calls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        this.api.push({ role: 'assistant', content: blocks });

        const results = [];
        for (const c of calls) {
          if (signal.aborted) { results.push(cancelled(c.id)); continue; }
          const r = await this.runTool(c, msg, signal);
          if (r.ok) okActions++;
          results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(r.result), ...(r.ok ? {} : { is_error: true }) });
          if (r.ok && r.card) this.emitter.emit('phase', 'action-ok');
        }
        this.api.push({ role: 'user', content: results });
        this.persist();
        if (signal.aborted) throw new AIError('aborted', 'Stopped');
        if (round === MAX_ROUNDS - 1) msg.parts.push({ type: 'note', text: 'I stopped there to avoid looping — tell me what to do next.' });
      }
      this.setStatus(msg, 'done');
      this.emitter.emit('phase', okActions ? 'done-happy' : 'done');
    } catch (e) {
      const err = e instanceof AIError ? e : new AIError('server', e?.message || 'Something went wrong.');
      if (err.kind === 'aborted') {
        if (roundText.trim()) this.api.push({ role: 'assistant', content: roundText });
        this.setStatus(msg, 'stopped');
        this.emitter.emit('phase', 'stopped');
      } else {
        this.setStatus(msg, 'error', { kind: err.kind, message: err.message });
        this.emitter.emit('phase', 'error');
      }
    } finally {
      this.busy = false;
      this.abortCtl = null;
      for (const [, res] of this.waiters) res('cancelled');
      this.waiters.clear();
      this.persist();
      this.emitter.emit('status', { busy: false });
    }
  }

  async streamRound(msg, signal, onText) {
    const now = new Date();
    const { messages, dropped } = trimContext(repairToolPairs(this.api), { maxChars: 60000, maxMessages: MAX_API });
    const system = buildSystem({
      style: prefs.get().style, studyMode: this.studyMode, now, dropped,
      tasks: T.snapshotForPrompt(now), events: E.snapshotForPrompt(now), studySnap: Study.snapshotForPrompt(now),
    });
    let text = '';
    const calls = [];
    let stop = 'end_turn';
    let first = true;
    await streamChat({
      url: runtime.apiUrl, signal, fetchImpl: this.fetchImpl,
      body: { system, messages, tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })) },
      onRetry: () => this.emitter.emit('phase', 'retrying'),
      onEvent: (type, data) => {
        if (type === 'text') {
          text += data.t;
          onText(text);
          let last = msg.parts[msg.parts.length - 1];
          if (!last || last.type !== 'text') { last = { type: 'text', text: '' }; msg.parts.push(last); }
          last.text += data.t;
          if (first) { first = false; this.emitter.emit('phase', 'token'); }
          this.emitter.emit('change', { kind: 'stream', id: msg.id });
        } else if (type === 'tool') {
          calls.push(data);
        } else if (type === 'done') {
          stop = data.stop || 'end_turn';
        }
      },
    });
    return { text, calls, stop };
  }

  async runTool(call, msg, signal) {
    const input = call.input && typeof call.input === 'object' ? call.input : {};
    const push = (part) => { msg.parts.push(part); this.emitter.emit('change', { kind: 'update', id: msg.id }); };
    const fail = (message) => { push({ type: 'action', id: call.id, tone: 'error', icon: 'x', title: message }); return { ok: false, result: { ok: false, error: message } }; };

    if (input.__parse_error) return fail('I sent a malformed action, so nothing was changed.');
    const pre = precheck(call.name, input);
    if (pre?.error) return fail(pre.error);

    let confirmPart = null;
    if (pre?.confirm) {
      confirmPart = { type: 'confirm', id: call.id, state: 'pending', ...pre.confirm };
      push(confirmPart);
      this.emitter.emit('phase', 'confirm');
      const decision = await new Promise((resolve) => {
        if (signal.aborted) return resolve('cancelled');
        this.waiters.set(call.id, resolve);
      });
      this.waiters.delete(call.id);
      confirmPart.state = decision;
      this.emitter.emit('change', { kind: 'update', id: msg.id });
      this.persist();
      if (decision === 'cancelled') return { ok: false, result: { ok: false, cancelled: true, note: 'The user stopped before deciding. Nothing was changed.' } };
      if (decision === 'declined') return { ok: false, result: { ok: false, declined: true, note: 'The user declined. Nothing was changed.' } };
    }

    let r;
    try { r = execute(call.name, input); } catch (e) { return fail('That action failed unexpectedly. Nothing was changed.'); }
    if (r.card) push({ type: 'action', id: call.id + ':r', ...r.card });
    if (r.quiz) push({ type: 'quiz', id: call.id, quiz: r.quiz, answers: r.quiz.questions.map(() => null), done: false });
    return r;
  }

  persist(now = false) {
    const view = this.view.slice(-MAX_VIEW);
    let api = this.api;
    if (api.length > MAX_API) {
      const { messages } = trimContext(api, { maxChars: 120000, maxMessages: MAX_API });
      api = messages;
      this.api = api;
    }
    store.set({ api, view });
    if (now) store.flush();
  }
}

const cancelled = (id) => ({ type: 'tool_result', tool_use_id: id, is_error: true, content: JSON.stringify({ ok: false, cancelled: true, note: 'Stopped by the user before this ran. Nothing was changed.' }) });

/** History restored from storage can't contain live states. */
function sanitizeRestored(m) {
  const msg = { ...m, parts: (m.parts || []).map((p) => (p.type === 'confirm' && p.state === 'pending' ? { ...p, state: 'cancelled' } : p)) };
  if (msg.status === 'streaming') msg.status = 'stopped';
  return msg;
}

export { isValidStart };
