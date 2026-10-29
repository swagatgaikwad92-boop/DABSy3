// Minimal, spec-compliant Server-Sent Events parser. Shared by the browser client and the Worker.
export class SSEParser {
  constructor() {
    this.buf = '';
    this.event = '';
    this.data = [];
  }

  /** Feed a text chunk; returns the complete events it finished: [{ event, data }]. */
  push(chunk) {
    this.buf += chunk;
    const out = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c !== '\n' && c !== '\r') continue;
      if (c === '\r' && i === this.buf.length - 1) break; // maybe half of \r\n — wait for the next chunk
      const line = this.buf.slice(start, i);
      if (c === '\r' && this.buf[i + 1] === '\n') i++;
      start = i + 1;
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  line(l) {
    if (l === '') {
      if (!this.data.length && !this.event) return null;
      const ev = { event: this.event || 'message', data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return ev;
    }
    if (l[0] === ':') return null; // comment / keep-alive
    const idx = l.indexOf(':');
    const field = idx === -1 ? l : l.slice(0, idx);
    let value = idx === -1 ? '' : l.slice(idx + 1);
    if (value[0] === ' ') value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}

export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
