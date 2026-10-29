// The message composer (the dock). One component serves both the home screen and the conversation.
import { h } from '../core/dom.js';
import { icon } from '../ui/icons.js';

export class Composer {
  constructor({ onSubmit, onStop, onFocus, onBlur, onInput }) {
    this.onSubmit = onSubmit;
    this.onStop = onStop;
    this.busy = false;
    this.input = h('textarea', {
      class: 'composer__input', rows: '1', maxlength: '4000', placeholder: 'Ask DABSy anything…', enterkeyhint: 'send',
      autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': 'Message DABSy',
    });
    this.btn = h('button', { class: 'send', type: 'button', 'aria-label': 'Send', disabled: true }, icon('send', 22, { stroke: 2.2 }));
    this.el = h('div', { class: 'composer glass' }, this.input, this.btn);

    this.input.addEventListener('input', () => { this.resize(); this.sync(); onInput?.(this.input.value); });
    this.input.addEventListener('focus', () => onFocus?.());
    this.input.addEventListener('blur', () => onBlur?.());
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      // On touch keyboards Enter is a newline unless it's the "send" action key; on desktop Enter sends.
      if (matchMedia('(pointer: coarse)').matches && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.submit();
    });
    // keep the keyboard up when tapping send/stop
    this.btn.addEventListener('pointerdown', (e) => e.preventDefault());
    this.btn.addEventListener('click', () => (this.busy ? this.onStop() : this.submit()));
  }

  submit() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this.resize();
    this.sync();
    this.onSubmit(text);
  }

  resize() {
    const i = this.input;
    i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight, 132) + 'px';
  }

  sync() {
    this.btn.disabled = !this.busy && !this.input.value.trim();
  }

  setBusy(busy) {
    this.busy = busy;
    this.btn.dataset.mode = busy ? 'stop' : 'send';
    this.btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    this.btn.replaceChildren(busy ? icon('stop', 20) : icon('send', 22, { stroke: 2.2 }));
    this.sync();
  }

  setPlaceholder(t) { this.input.placeholder = t; }

  setValue(v, { focus = true } = {}) {
    this.input.value = v;
    this.resize();
    this.sync();
    if (focus) { this.input.focus(); this.input.setSelectionRange(v.length, v.length); }
  }

  focus() { this.input.focus(); }
  get value() { return this.input.value; }
}
