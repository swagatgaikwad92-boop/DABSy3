// Conversation context management: keep what fits, never break tool_use/tool_result pairs.
const size = (m) => (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length);

const hasToolResult = (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');
const hasText = (m) => typeof m.content === 'string' ? m.content.trim().length > 0 : Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && b.text?.trim());

/** A valid conversation start is a user message that carries text and no tool results. */
export const isValidStart = (m) => m.role === 'user' && !hasToolResult(m) && hasText(m);

/**
 * Keep the most recent messages within `maxChars`, starting on a valid user turn.
 * Returns { messages, dropped } — `dropped` lets the system prompt mention that earlier turns were omitted.
 */
export function trimContext(messages, { maxChars = 60000, maxMessages = 60 } = {}) {
  let total = 0;
  let from = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += size(messages[i]);
    if (total > maxChars || messages.length - i > maxMessages) break;
    from = i;
  }
  // always keep at least the last message
  if (from === messages.length && messages.length) from = messages.length - 1;
  while (from < messages.length && !isValidStart(messages[from])) from++;
  if (from >= messages.length) {
    // nothing valid in window (e.g. an oversized single turn): fall back to the last user text turn
    for (let i = messages.length - 1; i >= 0; i--) if (isValidStart(messages[i])) { from = i; break; }
    if (from >= messages.length) from = 0;
  }
  return { messages: messages.slice(from), dropped: from };
}

/** Make sure every tool_use has a matching tool_result in the next message (defensive repair for restored history). */
export function repairToolPairs(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const uses = Array.isArray(m.content) && m.role === 'assistant' ? m.content.filter((b) => b.type === 'tool_use') : [];
    if (uses.length) {
      const next = messages[i + 1];
      const resultIds = new Set(Array.isArray(next?.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : []);
      if (!uses.every((u) => resultIds.has(u.id))) {
        // drop the dangling tool exchange: keep only the text blocks of this assistant turn
        const text = m.content.filter((b) => b.type === 'text' && b.text);
        if (text.length) out.push({ role: 'assistant', content: text });
        if (next && hasToolResult(next)) i++; // skip the partial results too
        continue;
      }
    }
    out.push(m);
  }
  return out;
}
