/* Keyless resource discovery + verification for the DABSy Worker.
   Nothing here needs an API key. Everything returned was actually fetched and checked:
   - YouTube results come from YouTube's own search response; each video is then checked with the
     public oEmbed endpoint (401 = embedding disabled, 404 = unavailable/private) so we never recommend
     a video Study Space can't play.
   - PDFs are only returned if a ranged GET shows a real PDF (content-type or %PDF- header).
   These are scraping-style endpoints: they can break when the providers change their markup, and
   they must be used lightly (the Worker rate-limits). The Worker returns an honest error if they fail. */

const UA = "Mozilla/5.0 (compatible; DABSyStudyBot/1.0; +https://github.com)";

function secs(txt){
  if(!txt) return null;
  const p = String(txt).split(":").map(Number); if(p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
}
const runs = o => o ? (o.simpleText || (o.runs || []).map(r => r.text).join("")) : "";

function collect(o, out, depth){
  if(!o || typeof o !== "object" || depth > 14) return;
  if(o.videoRenderer && o.videoRenderer.videoId){ out.push(o.videoRenderer); return; }
  for(const k in o) collect(o[k], out, depth + 1);
}

export async function ytSearch(q, max){
  const r = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en", gl: "US" } }, query: q, params: "EgIQAQ%3D%3D" }),
  });
  if(!r.ok) throw new Error("yt-" + r.status);
  const d = await r.json(); const vr = []; collect(d, vr, 0);
  return vr.filter(v => v.lengthText).slice(0, max || 14).map(v => {
    const s = secs(runs(v.lengthText));
    return { title: runs(v.title), url: "https://www.youtube.com/watch?v=" + v.videoId, source: runs(v.ownerText) || "youtube.com", type: "video", durationMin: s ? Math.max(1, Math.round(s / 60)) : null,
      description: runs((v.detailedMetadataSnippets && v.detailedMetadataSnippets[0] && v.detailedMetadataSnippets[0].snippetText) || v.descriptionSnippet), videoId: v.videoId, channelVerified: !!(v.ownerBadges && v.ownerBadges.length) };
  });
}

export async function ytEmbeddable(id){
  try{
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { headers: { "user-agent": UA } });
    if(r.status === 200) return true;
    if(r.status === 401 || r.status === 403 || r.status === 404) return false;
    return null;                                     // unknown: don't claim anything
  }catch(e){ return null; }
}

export async function verifyPdf(url){
  try{
    const r = await fetch(url, { headers: { Range: "bytes=0-1023", "user-agent": UA }, redirect: "follow" });
    if(!(r.ok || r.status === 206)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const magic = new TextDecoder().decode(buf.slice(0, 5)) === "%PDF-";
    if(!magic && !/pdf/i.test(r.headers.get("content-type") || "")) return null;
    const cr = /\/(\d+)$/.exec(r.headers.get("content-range") || ""); const size = cr ? Number(cr[1]) : Number(r.headers.get("content-length")) || null;
    return { bytes: size };
  }catch(e){ return null; }
}

export async function pdfSearch(q, max){
  const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q + " filetype:pdf"), { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
  if(!r.ok) throw new Error("ddg-" + r.status);
  const html = await r.text(); const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m; while((m = re.exec(html)) && out.length < (max || 8)){
    let href = m[1].replace(/&amp;/g, "&"); const u = /[?&]uddg=([^&]+)/.exec(href); if(u) href = decodeURIComponent(u[1]); else if(href.startsWith("//")) href = "https:" + href;
    if(!/^https:\/\//.test(href) || !/\.pdf(\?|#|$)/i.test(href)) continue;
    const strip = s => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
    out.push({ title: strip(m[2]), url: href, source: new URL(href).hostname.replace(/^www\./, ""), type: "pdf", description: strip(m[3]).slice(0, 200) });
  }
  return out;
}

/* ---------- PDF proxy (lets Study Space read PDFs from sites without CORS) ---------- */
const MAX_PDF = 25 * 1024 * 1024;
export function safeUrl(u){
  let x; try{ x = new URL(u); }catch(e){ return null; }
  if(x.protocol !== "https:" || x.username || x.password) return null;
  const h = x.hostname.toLowerCase();
  if(h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || !h.includes(".")) return null;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || /^\[/.test(h)) return null;      // no IP literals
  if(x.port && x.port !== "443") return null;
  return x;
}
export async function fetchPdf(url){
  let cur = safeUrl(url); if(!cur) return { error: "bad-url", status: 400 };
  for(let hop = 0; hop < 4; hop++){
    const r = await fetch(cur.toString(), { redirect: "manual", headers: { "user-agent": UA, accept: "application/pdf,*/*;q=0.5" } });
    if(r.status >= 300 && r.status < 400 && r.headers.get("location")){ cur = safeUrl(new URL(r.headers.get("location"), cur).toString()); if(!cur) return { error: "bad-redirect", status: 400 }; continue; }
    if(!r.ok) return { error: "upstream-" + r.status, status: 502 };
    if(Number(r.headers.get("content-length") || 0) > MAX_PDF) return { error: "too-large", status: 413 };
    const reader = r.body.getReader(), chunks = []; let n = 0;
    for(;;){ const { done, value } = await reader.read(); if(done) break; n += value.length; if(n > MAX_PDF){ try{ reader.cancel(); }catch(e){} return { error: "too-large", status: 413 }; } chunks.push(value); }
    const buf = new Uint8Array(n); let o = 0; for(const c of chunks){ buf.set(c, o); o += c.length; }
    if(new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") return { error: "not-pdf", status: 415 };
    return { body: buf };
  }
  return { error: "too-many-redirects", status: 502 };
}
