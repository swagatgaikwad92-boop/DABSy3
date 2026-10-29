// TEST FIXTURE ONLY — never shipped. A scripted stand-in for the DABSy backend that speaks the same SSE protocol
// (text / tool / done / error), so the real client, streaming, cancellation and tool loop can be exercised end-to-end.
import http from 'node:http';
import { sseFrame } from '../../src/ai/sse.js';

export function createMockBackend() {
  const log = [];
  let flaky = 0;
  const lastUserText = (messages) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      if (typeof m.content === 'string') return m.content;
      const t = m.content.find((b) => b.type === 'text');
      if (t) return t.text;
    }
    return '';
  };
  const lastToolResult = (messages) => {
    const m = messages[messages.length - 1];
    if (m?.role === 'user' && Array.isArray(m.content)) {
      const r = m.content.find((b) => b.type === 'tool_result');
      if (r) { try { return { ...JSON.parse(r.content), is_error: !!r.is_error }; } catch { return { ok: false }; } }
    }
    return null;
  };
  const firstTaskId = (system) => /id=(t_\w+)/.exec(system)?.[1];

  const LONG = `## Why the sky is blue\n\nSunlight looks white, but it is a mix of every colour. As it enters the atmosphere it collides with gas molecules, and **shorter wavelengths scatter far more** than longer ones — a effect called *Rayleigh scattering*.\n\n### Key ideas\n\n- Blue light scatters about 10× more than red\n- Violet scatters even more, but our eyes are less sensitive to it\n- At sunset the light travels through more air, so the blue is scattered away\n\n| Colour | Wavelength | Scattering |\n|---|---|---|\n| Red | 700 nm | low |\n| Blue | 450 nm | high |\n\n\`\`\`python\nimport math\nscatter = lambda wl: 1 / wl ** 4\nprint(scatter(450) / scatter(700))\n\`\`\`\n\n1. Light enters the atmosphere\n2. Molecules scatter short wavelengths\n3. You see blue from every direction\n\n${'More detail about scattering and why this matters for everyday observation. '.repeat(18)}\n\nThat is the whole story.`;

  async function plan(body) {
    const { messages, system } = body;
    const text = lastUserText(messages);
    const tr = lastToolResult(messages);
    const t = text.toLowerCase();
    const events = [];
    const say = (s, chunk = 14, delay = 8) => events.push({ say: s, chunk, delay });
    const tool = (name, input) => events.push({ tool: { id: 'toolu_' + Math.random().toString(36).slice(2, 10), name, input } });

    if (tr) {
      if (tr.declined) say('Okay — I left everything as it was.');
      else if (tr.ok === false) say(`That didn’t work: ${tr.error || 'it failed'}.`);
      else if (tr.created || tr.scheduled) say(`Your plan is saved: ${tr.created.length} new, ${tr.scheduled.length} scheduled.`);
      else if (tr.deleted) say('Deleted it.');
      else if (tr.task) say(`Done — “${tr.task.title}” is ${tr.existed ? 'already there' : 'set'}.`);
      else say('Done.');
    } else if (t.includes('slow')) {
      for (let i = 0; i < 40; i++) events.push({ say: `word${i} `, chunk: 99, delay: 300 });
    } else if (t.includes('long')) say(LONG, 11, 6);
    else if (t.startsWith('add task')) tool('create_task', { title: text.slice(9).trim(), due: 'today' });
    else if (t.includes('plan my day')) {
      const id = firstTaskId(system);
      tool('plan_day', { date: 'today', summary: 'A focused morning, lighter afternoon.', items: [
        { title: 'Deep work block', time: '09:00', priority: 'high' }, ...(id ? [{ title: 'x', existing_id: id, time: '11:00' }] : []), { title: 'Walk outside', time: '17:30', priority: 'low' } ] });
    } else if (t.includes('delete task')) tool('delete_task', { id: firstTaskId(system) || 'nope' });
    else if (t.includes('rename task')) tool('rename_task', { id: firstTaskId(system) || 'nope', title: 'Renamed by DABSy' });
    else if (t.includes('bad id')) tool('complete_task', { id: 't_doesnotexist' });
    else if (t.includes('quiz')) { tool('present_quiz', { topic: 'Photosynthesis', questions: [
      { question: 'Which gas do plants absorb?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen'], correct_index: 1, explanation: 'Plants take in CO₂.' },
      { question: 'Where does it happen?', options: ['Chloroplast', 'Nucleus'], correct_index: 0, explanation: 'Chloroplasts hold chlorophyll.' } ] }); }
    else if (t.includes('error')) events.push({ error: 'The AI service is busy right now. Please try again in a moment.' });
    else if (t.includes('context')) say(`I received ${messages.length} message(s). First: "${typeof messages[0].content === 'string' ? messages[0].content.slice(0, 40) : 'blocks'}"`);
    else if (t.includes('sysinfo')) say(`study=${system.includes('STUDY MODE IS ON')} style=${/RESPONSE LENGTH: (\w+)/.exec(system)?.[1]} tools=${(body.tools || []).length}`);
    else say(`You said: ${text}`);
    return events;
  }

  const server = http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, model: 'mock-1' })); return; }
    if (url.pathname === '/__requests') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(log)); return; }
    if (url.pathname === '/__reset') { log.length = 0; flaky = 0; res.writeHead(204, cors).end(); return; }
    if (url.pathname !== '/chat') { res.writeHead(404, cors).end(); return; }
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    log.push({ at: Date.now(), messages: body.messages.length, last: lastUserText(body.messages), system: body.system, tools: (body.tools || []).map((t) => t.name) });
    const text = lastUserText(body.messages).toLowerCase();
    if (text.includes('flaky') && flaky++ === 0) { req.socket.destroy(); return; }
    if (text.includes('http503')) { res.writeHead(503, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'overloaded', message: 'busy' } })); return; }
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    let aborted = false;
    res.on('close', () => { aborted = true; });
    const events = await plan(body);
    let hadTool = false, failed = false;
    for (const ev of events) {
      if (aborted) return;
      if (ev.say != null) {
        for (let i = 0; i < ev.say.length; i += ev.chunk) {
          if (aborted) return;
          res.write(sseFrame('text', { t: ev.say.slice(i, i + ev.chunk) }));
          await new Promise((r) => setTimeout(r, ev.delay));
        }
      } else if (ev.tool) { hadTool = true; res.write(sseFrame('tool', ev.tool)); }
      else if (ev.error) { failed = true; res.write(sseFrame('error', { code: 'overloaded_error', message: ev.error })); }
    }
    if (!failed) res.write(sseFrame('done', { stop: hadTool ? 'tool_use' : 'end_turn' }));
    res.end();
  });
  return { server, log };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { server } = createMockBackend();
  server.listen(Number(process.env.PORT || 8787), () => console.log('mock backend on', server.address().port));
}
