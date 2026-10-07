/**
 * Local, synthetic hydrated React benchmark. No auth, database or Next build.
 * npx tsx tests/perf/opt-cliente.mts antes 172a1d8
 * npx tsx tests/perf/opt-cliente.mts despues
 * Next Link/router are bounded HTTP adapters, NOT production navigation timings.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const label = process.argv[2] ?? 'despues';
const baseline = process.argv[3];
const out = path.resolve(process.env.PERF_CLIENTE_SALIDA ?? path.join(
  process.env.CALENDARIO_DATOS ?? path.join(homedir(), 'calendario-datos'),
  'calendario-trabajo', 'perf', 'opt-red-lenta', 'cliente',
));
await mkdir(out, { recursive: true });
const next = `
import * as React from 'react';
const cache=new Map();
export const router={replace:navigate,push:navigate};
async function navigate(url) {
  const data=await fetch('/stub/route?url='+encodeURIComponent(url)).then(r=>r.json());
  history.replaceState({},'',url);
  window.dispatchEvent(new CustomEvent('route',{detail:data.url}));
}
export const useRouter=()=>router;
export const usePathname=()=>location.pathname;
export const useSearchParams=()=>new URLSearchParams(location.search);
export const useLinkStatus=()=>({pending:false});
export default React.forwardRef(function Link({href,prefetch,transitionTypes,onClick,...props},ref){
 React.useEffect(()=>{if(prefetch&&!cache.has(href))cache.set(href,fetch('/stub/link?url='+encodeURIComponent(href)).then(r=>r.json()));},[href,prefetch]);
 return <a {...props} href={href} ref={ref} onClick={async e=>{
  onClick?.(e);if(e.defaultPrevented)return;e.preventDefault();
  await (cache.get(href)??fetch('/stub/link?url='+encodeURIComponent(href)));
  document.getElementById('destination').textContent=href;
 }}/>;
});
`;
const entry = `
import * as React from 'react';
import {hydrateRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {EnlacePrecarga} from '@/components/sistema/enlace-precarga';
import {EnlaceIntencion} from '@/components/enlace-intencion';
import {FotoDeportista,fotoDe} from '@/components/explorar/foto-deportista';
import {BuscadorCompeticiones} from '@/components/explorar/buscador-competiciones';
window.retryPhoto=id=>fotoDe(id??'retry',true);
const mode=new URLSearchParams(location.search).get('mode');
function App(){
 const [q,setQ]=React.useState('');
 React.useEffect(()=>{
  const update=e=>setQ(new URL(e.detail,location.origin).searchParams.get('q')??'');
  window.addEventListener('route',update);window.ready=true;
  return()=>window.removeEventListener('route',update);
 },[]);
 if(mode==='search')return <BuscadorCompeticiones criterios={{q,fuente:'',arma:'',categoria:'',desde:'',hasta:'',temporada:''}} anioActual={2026}><p id="results">Resultados: {q||'anteriores'}</p></BuscadorCompeticiones>;
 if(mode==='photos')return <div id="scroll" style={{height:480,overflowY:'auto'}}>{Array.from({length:60},(_,i)=><div key={i} style={{height:80,display:'flex',alignItems:'center'}}><FotoDeportista personaId={'p'+i} nombre={'Persona Sintética '+i} tamano="lista"/><span>Persona sintética {i}</span></div>)}</div>;
 return <><h1>Enlaces sintéticos</h1>{Array.from({length:20},(_,i)=>{const Link=i%2?EnlaceIntencion:EnlacePrecarga;return <Link key={i} href={'/destino/'+i} data-link={i}>Destino {i}</Link>})}<p id="destination">Anterior</p></>;
}
document.getElementById('root').innerHTML=renderToString(<App/>);
hydrateRoot(document.getElementById('root'),<App/>);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, minify: true, format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'next-adapter',
    setup(b) {
      b.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: 'next', namespace: 'adapter' }));
      b.onLoad({ filter: /.*/, namespace: 'adapter' }, () => ({ contents: next, loader: 'tsx', resolveDir: root }));
      // Read-only Git objects: no checkout, no index or working-tree writes.
      if (baseline) b.onLoad({ filter: /[\\/]src[\\/]components[\\/].*\.tsx?$/ }, args => ({
        contents: execFileSync('git', ['show', baseline + ':' + path.relative(root, args.path).replaceAll('\\', '/')], { cwd: root, encoding: 'utf8' }),
        loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
        resolveDir: path.dirname(args.path),
      }));
    },
  }],
});
const requests: { url: string; bytes: number }[] = [];
const server = createServer((req, res) => {
  const u = new URL(req.url!, 'http://local');
  if (u.pathname === '/app.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return;
  }
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/stub/')) {
    let data: unknown = { url: u.searchParams.get('url'), padding: 'x'.repeat(4096) };
    if (u.pathname === '/api/explorar/fotos') data = { estado: 'ok', fotos: Object.fromEntries((u.searchParams.get('ids') ?? '').split(',').map(id => [id, { estado: 'foto_no_publicada' }])) };
    else if (u.pathname.startsWith('/api/')) data = { estado: 'foto_no_publicada' };
    const body = JSON.stringify(data);
    requests.push({ url: req.url!, bytes: Buffer.byteLength(body) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body); return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:16px}a{display:block;min-height:44px}input{min-height:44px}svg{width:18px;height:18px}#scroll{border:1px solid #aaa}</style><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const browser = await chromium.launch({ headless: true });
const reports: unknown[] = [];
try {
  for (const profile of [
    { name: 'movil', latency: 150, kbps: 1600, save: false },
    { name: 'aeropuerto', latency: 400, kbps: 400, save: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(({ save }) => {
      Object.defineProperty(navigator, 'connection', { value: { saveData: save, effectiveType: save ? '2g' : '4g' } });
      (window as any).longTasks = [];
      new PerformanceObserver(list => (window as any).longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
    }, profile);
    const page = await context.newPage();
    page.on('pageerror', error => console.error(error));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.kbps * 1000 / 8, uploadThroughput: profile.kbps * 1000 / 8 });
    if (profile.save) await context.setExtraHTTPHeaders({ 'Save-Data': 'on' });
    const open = async (mode: string) => {
      const start = performance.now();
      await page.goto(`http://127.0.0.1:${port}/?mode=${mode}`);
      await page.waitForFunction(() => (window as any).ready);
      requests.length = 0;
      await page.evaluate(() => { (window as any).longTasks = []; });
      return Math.round(performance.now() - start);
    };
    const reloadMs = await open('links');
    for (let i = 0; i < 20; i++) {
      await page.locator(`[data-link="${i}"]`).dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true });
      await page.locator(`[data-link="${i}"]`).dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
      await page.locator(`[data-link="${i}"]`).dispatchEvent('touchstart');
      await page.locator(`[data-link="${i}"]`).dispatchEvent('pointercancel', { pointerType: 'touch' });
    }
    await page.waitForTimeout(600);
    const scrollLinks = { requests: requests.length, bytes: requests.reduce((n, r) => n + r.bytes, 0) };
    const clickStart = performance.now();
    await page.locator('[data-link="0"]').click();
    await page.waitForFunction(() => document.getElementById('destination')?.textContent === '/destino/0');
    const clickMs = Math.round(performance.now() - clickStart);
    const linkLongTasks = await page.evaluate(() => (window as any).longTasks);
    await open('photos');
    // Rows enter the viewport but leave before the 350ms dwell threshold.
    for (let top = 0; top <= 4000; top += 480) {
      await page.locator('#scroll').evaluate((el, y) => { el.scrollTop = y; }, top);
      await page.waitForTimeout(65);
    }
    await page.waitForTimeout(3000);
    if (!requests.some(r => r.url.startsWith('/api/explorar/'))) throw new Error('Visible photo metadata did not recover after scrolling');
    const photoRequests = [...requests];
    const photoIds = new Set(photoRequests.flatMap(r => {
      const u = new URL(r.url, 'http://local');
      return u.searchParams.get('ids')?.split(',') ?? [u.pathname.split('/').at(-2)!];
    }));
    const photoLongTasks = await page.evaluate(() => (window as any).longTasks);
    await open('search');
    const start = performance.now();
    await page.locator('#catalogo-q').fill('turin');
    await page.locator('#catalogo-q').press('Enter');
    await page.waitForFunction(() => document.getElementById('results')?.textContent === 'Resultados: turin');
    const searchMs = Math.round(performance.now() - start);
    await page.waitForTimeout(700);
    const search = { requests: requests.length, bytes: requests.reduce((n, r) => n + r.bytes, 0), ms: searchMs, longTasks: await page.evaluate(() => (window as any).longTasks) };
    await page.screenshot({ path: path.join(out, `${label}-${profile.name}.png`) });
    await open('search');
    await page.evaluate(() => {
      (window as any).inputPaint = [];
      document.getElementById('catalogo-q')!.addEventListener('input', () => {
        const now = performance.now();
        (window as any).lastInputAt = now;
        requestAnimationFrame(() => requestAnimationFrame(() => (window as any).inputPaint.push(performance.now() - now)));
      });
    });
    await page.locator('#catalogo-q').pressSequentially('turin', { delay: 150 });
    assert.notEqual(await page.locator('#results').textContent(), '', 'Previous UI remains while navigating');
    await page.waitForFunction(() => document.getElementById('results')?.textContent === 'Resultados: turin');
    const rapidMs = await page.evaluate(() => Math.round(performance.now() - (window as any).lastInputAt));
    await page.waitForTimeout(700);
    const rapid = { requests: requests.length, bytes: requests.reduce((n, r) => n + r.bytes, 0), lastKeyToContentMs: rapidMs, inputToTwoFramesMs: await page.evaluate(() => (window as any).inputPaint), longTasks: await page.evaluate(() => (window as any).longTasks) };
    if (!baseline) {
      assert.equal(scrollLinks.requests, 0, 'Scroll is not navigation intent');
      assert.equal(photoIds.size, 6, 'Only stable visible rows ask for metadata');
      assert.equal(search.requests, 1, 'Enter cancels the pending debounce');
      // Negative cache and overlapping consumers reuse the same promise.
      requests.length = 0;
      await page.evaluate(() => Promise.all([(window as any).retryPhoto('negative'), (window as any).retryPhoto('negative')]));
      await page.evaluate(() => (window as any).retryPhoto('negative'));
      assert.equal(requests.length, 1);
      await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await page.evaluate(() => (window as any).retryPhoto('offline'));
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.kbps * 1000 / 8, uploadThroughput: profile.kbps * 1000 / 8 });
      requests.length = 0;
      await page.evaluate(() => (window as any).retryPhoto('offline'));
      assert.equal(requests.length, 1, 'Offline failures can retry');
      await open('links');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(700);
      assert.equal(requests.length, profile.save ? 0 : 1, 'Keyboard intent respects Save-Data');
      await page.locator('[data-link="0"]').press('Enter');
      await page.waitForFunction(() => document.getElementById('destination')?.textContent === '/destino/0');
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      // Desktop hover: fleeting passes cancel, dwelling prefetches only on normal networks.
      await page.setViewportSize({ width: 1280, height: 800 });
      requests.length = 0;
      await page.locator('[data-link="1"]').dispatchEvent('pointerover', { pointerType: 'mouse' });
      await page.locator('[data-link="1"]').dispatchEvent('pointerout', { pointerType: 'mouse' });
      await page.waitForTimeout(200);
      assert.equal(requests.length, 0);
      await page.locator('[data-link="2"]').dispatchEvent('pointerover', { pointerType: 'mouse' });
      await page.waitForTimeout(700);
      assert.equal(requests.length, profile.save ? 0 : 1);
      if (!profile.save) await page.screenshot({ path: path.join(out, `${label}-desktop.png`) });
    }
    reports.push({ profile, reloadMs, harnessBundleBytes: bundle.outputFiles[0].contents.length, scrollLinks, clickMs, linkLongTasks, photos: { requests: photoRequests.length, ids: photoIds.size, bytes: photoRequests.reduce((n, r) => n + r.bytes, 0), longTasks: photoLongTasks }, search, rapid, checks: baseline ? 'baseline only' : 'scroll, visible photos, submit, negative cache, offline retry, keyboard, hover, reduced-motion' });
    await context.close();
  }
  await writeFile(path.join(out, `${label}.json`), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  server.close();
}
