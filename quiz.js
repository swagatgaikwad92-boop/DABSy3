// Practice-quiz validation. The model proposes questions through a tool call; nothing is rendered unless it is well-formed.
export const MAX_QUESTIONS = 8;

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function normalizeQuiz(input) {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  if (!qs.length) return { ok: false, error: 'A quiz needs at least one question.' };
  const questions = [];
  for (const [i, q] of qs.slice(0, MAX_QUESTIONS).entries()) {
    const question = clean(q?.question, 400);
    const options = Array.isArray(q?.options) ? q.options.map((o) => clean(o, 200)).filter(Boolean) : [];
    const correct = Number.isInteger(q?.correct_index) ? q.correct_index : -1;
    if (!question) return { ok: false, error: `Question ${i + 1} has no text.` };
    if (options.length < 2 || options.length > 5) return { ok: false, error: `Question ${i + 1} needs 2–5 options.` };
    if (correct < 0 || correct >= options.length) return { ok: false, error: `Question ${i + 1}: correct_index is out of range (0–${options.length - 1}).` };
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { ok: false, error: `Question ${i + 1} has duplicate options.` };
    questions.push({ question, options, correct, explanation: clean(q?.explanation, 600) });
  }
  return { ok: true, quiz: { topic: clean(input?.topic, 100) || 'Practice', questions } };
}
