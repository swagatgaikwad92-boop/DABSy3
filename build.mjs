// Production/dev build: esbuild bundle (JS + CSS), static copy, index.html + service worker generation.
import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

async function listFiles(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

export async function buildApp({ dev = false } = {}) {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(path.join(ROOT, 'public'), DIST, { recursive: true });

  const result = await build({
    entryPoints: [path.join(ROOT, 'src/main.js')],
    outdir: path.join(DIST, 'assets'),
    entryNames: 'app-[hash]',
    bundle: true,
    format: 'esm',
    target: ['chrome100', 'safari15', 'firefox100'],
    minify: !dev,
    sourcemap: dev ? 'inline' : 'linked',
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
    define: { __DEV__: JSON.stringify(dev) },
  });

  const outputs = Object.keys(result.metafile.outputs).map((f) => path.basename(f));
  const js = outputs.find((f) => f.endsWith('.js'));
  const css = outputs.find((f) => f.endsWith('.css'));
  if (!js || !css) throw new Error('build produced no JS/CSS output');

  const version = createHash('sha1').update(await readFile(path.join(DIST, 'assets', js))).update(await readFile(path.join(DIST, 'assets', css))).digest('hex').slice(0, 10);

  let html = await readFile(path.join(ROOT, 'src/index.html'), 'utf8');
  html = html.replaceAll('%JS%', `./assets/${js}`).replaceAll('%CSS%', `./assets/${css}`).replaceAll('%VERSION%', version);
  await writeFile(path.join(DIST, 'index.html'), html);

  const files = (await listFiles(DIST)).filter((f) => !f.endsWith('.map') && f !== 'sw.js' && f !== 'config.json');
  const precache = ['./', ...files.map((f) => './' + f)];
  let sw = await readFile(path.join(ROOT, 'src/sw.js'), 'utf8');
  sw = sw.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)).replace('__DEV__', String(dev));
  await writeFile(path.join(DIST, 'sw.js'), sw);

  return { js, css, version, files: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const r = await buildApp({ dev: process.argv.includes('--dev') });
  const { stat } = await import('node:fs/promises');
  const sz = async (f) => ((await stat(path.join(DIST, 'assets', f))).size / 1024).toFixed(1);
  console.log(`built v${r.version} in ${(performance.now() - t0).toFixed(0)}ms — ${r.js} ${await sz(r.js)}KB, ${r.css} ${await sz(r.css)}KB, ${r.files} files`);
}
