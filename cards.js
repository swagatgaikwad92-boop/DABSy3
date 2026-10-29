// Inline cards inside the transcript: butler actions, confirmations, and practice quizzes.
import { h } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { fmtClock } from '../core/time.js';

export function actionCard(p) {
  return h('div', { class: `act act--${p.tone || 'ok'}`, role: 'status' },
    h('span', { class: 'act__ic' }, icon(p.icon || 'check', 16, { stroke: 2.2 })),
    h('div', { class: 'act__txt' }, h('b', null, p.title), p.detail ? h('span', null, p.detail) : null));
}

export function confirmCard(p, { onDecide }) {
  const el = h('div', { class: `confirm confirm--${p.kind}${p.danger ? ' confirm--danger' : ''}`, 'data-state': p.state });
  el.append(h('div', { class: 'confirm__title' }, p.title));
  if (p.detail) el.append(h('div', { class: 'confirm__detail' }, p.detail));
  if (p.rows?.length) {
    el.append(h('ol', { class: 'confirm__rows' }, ...p.rows.map((r) => h('li', null,
      h('span', { class: 'confirm__time' }, r.time ? fmtClock(r.time) : '—'),
      h('span', { class: 'confirm__what' }, r.title),
      r.existing ? h('span', { class: 'tag' }, 'existing') : null,
      h('span', { class: 'dot-p', 'data-p': r.priority, title: `${r.priority} priority` })))));
  }
  if (p.state === 'pending') {
    el.append(h('div', { class: 'confirm__btns' },
      h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: () => onDecide(false) }, 'Not now'),
      h('button', { class: `btn btn--sm ${p.danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', onclick: () => onDecide(true) }, p.confirmLabel || 'Confirm')));
  } else {
    const label = { accepted: 'Confirmed', declined: 'Declined — nothing changed', cancelled: 'Cancelled — nothing changed' }[p.state] || '';
    el.append(h('div', { class: 'confirm__done' }, label));
  }
  return el;
}

/** Interactive multiple-choice quiz. Answers are checked locally and recorded through onAnswer. */
export function quizCard(p, { onAnswer, onReview }) {
  const { quiz, answers } = p;
  const answered = answers.filter((a) => a != null).length;
  const el = h('div', { class: 'quiz', 'data-done': p.done ? '1' : '0' });
  el.append(h('div', { class: 'quiz__head' }, h('b', null, quiz.topic), h('span', { class: 'muted' }, `${answered}/${quiz.questions.length}`)));

  let open = answers.findIndex((a) => a == null);
  if (open === -1) open = -1;
  quiz.questions.forEach((q, qi) => {
    const picked = answers[qi];
    const isOpen = qi === open;
    const sec = h('section', { class: 'quiz__q', 'data-open': isOpen ? '1' : '0', 'data-state': picked == null ? 'todo' : picked === q.correct ? 'right' : 'wrong' });
    const head = h('button', { class: 'quiz__qh', type: 'button', 'aria-expanded': String(isOpen) },
      h('span', { class: 'quiz__n' }, picked == null ? String(qi + 1) : icon(picked === q.correct ? 'check' : 'x', 14, { stroke: 2.4 })),
      h('span', { class: 'quiz__qt' }, q.question));
    head.addEventListener('click', () => {
      const now = sec.dataset.open === '1';
      sec.dataset.open = now ? '0' : '1';
      head.setAttribute('aria-expanded', String(!now));
    });
    sec.append(head);
    const body = h('div', { class: 'quiz__body' });
    q.options.forEach((opt, oi) => {
      const state = picked == null ? '' : oi === q.correct ? 'right' : oi === picked ? 'wrong' : 'dim';
      body.append(h('button', {
        class: 'quiz__opt', type: 'button', 'data-state': state, disabled: picked != null,
        onclick: () => onAnswer(qi, oi),
      }, h('span', { class: 'quiz__key' }, String.fromCharCode(65 + oi)), h('span', null, opt)));
    });
    if (picked != null) {
      body.append(h('div', { class: 'quiz__why' }, h('b', null, picked === q.correct ? 'Correct. ' : `Not quite — the answer is ${String.fromCharCode(65 + q.correct)}. `), q.explanation || ''));
    }
    sec.append(body);
    el.append(sec);
  });

  if (p.done) {
    const right = answers.filter((a, i) => a === quiz.questions[i].correct).length;
    const missed = quiz.questions.length - right;
    el.append(h('div', { class: 'quiz__result' },
      h('div', null, h('b', null, `${right} / ${quiz.questions.length}`), h('span', { class: 'muted' }, right === quiz.questions.length ? ' · flawless' : ' correct')),
      missed ? h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: onReview }, 'Go over the misses') : null));
  }
  return el;
}
