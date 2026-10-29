// Widget layout model (pure, unit-tested): ordering, visibility, sizes and per-widget options.
// A widget definition: { id, title, sizes: ['s'|'m'|'l'...], defaultSize, options?: [{key,label,type,choices?,default}] }

export function resolveLayout(defs, saved) {
  const known = new Map(defs.map((d) => [d.id, d]));
  const order = [];
  for (const id of saved.order || []) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const d of defs) if (!order.includes(d.id)) order.push(d.id); // new widgets from later versions appear at the end
  const hidden = new Set((saved.hidden || []).filter((id) => known.has(id)));
  return order.map((id) => {
    const d = known.get(id);
    const size = d.sizes.includes(saved.sizes?.[id]) ? saved.sizes[id] : d.defaultSize;
    const opts = {};
    for (const o of d.options || []) opts[o.key] = saved.opts?.[id]?.[o.key] ?? o.default;
    return { id, def: d, visible: !hidden.has(id), size, opts };
  });
}

export function moveWidget(order, id, delta) {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
