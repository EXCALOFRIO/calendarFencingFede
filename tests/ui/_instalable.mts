/**
 * ¿Se puede instalar de verdad como aplicación?
 *
 * No se conforma con «existe el manifiesto»: comprueba una a una las
 * condiciones que exige Chrome para ofrecer la instalación en Android, y por
 * separado las que necesita Safari en el iPhone, que son otras.
 *
 *   BASE=https://...workers.dev npx tsx tests/ui/_instalable.mts
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(`${BASE}/entrar`, { waitUntil: 'networkidle', timeout: 90_000 });

let problemas = 0;
const comprobar = (que: string, bien: boolean, detalle = '') => {
  console.log(`${bien ? '·' : '✗'} ${que}${detalle ? `  ${detalle}` : ''}`);
  if (!bien) problemas += 1;
};

// --------------------------------------------------------------- Android --
const enlace = await p.locator('link[rel="manifest"]').getAttribute('href');
comprobar('la página declara el manifiesto', Boolean(enlace), enlace ?? '');

const m = await p.evaluate(async (href) => {
  const r = await fetch(href!);
  return { estado: r.status, tipo: r.headers.get('content-type'), datos: await r.json() };
}, enlace);

comprobar('el manifiesto se sirve', m.estado === 200, `HTTP ${m.estado}`);
comprobar('name', Boolean(m.datos.name), m.datos.name);
comprobar('short_name', Boolean(m.datos.short_name), m.datos.short_name);
comprobar('start_url', Boolean(m.datos.start_url), m.datos.start_url);
comprobar(
  'display instalable',
  ['standalone', 'fullscreen', 'minimal-ui'].includes(m.datos.display),
  m.datos.display,
);

const iconos: { src: string; sizes: string; purpose?: string }[] = m.datos.icons ?? [];
const tiene = (lado: string, prop: string) =>
  iconos.some((i) => i.sizes === lado && (i.purpose ?? 'any').includes(prop));

comprobar('icono 192 «any»', tiene('192x192', 'any'));
comprobar('icono 512 «any»', tiene('512x512', 'any'));
comprobar(
  'icono «maskable» (Android lo recorta con la forma del lanzador)',
  iconos.some((i) => (i.purpose ?? '').includes('maskable')),
);

for (const i of iconos) {
  const r = await p.evaluate(async (src) => (await fetch(src)).status, i.src);
  comprobar(`  se sirve ${i.src}`, r === 200, `HTTP ${r}`);
}

const sw = await p.evaluate(async () => {
  const r = await fetch('/sw.js');
  return { estado: r.status, conFetch: (await r.text()).includes("addEventListener('fetch'") };
});
comprobar('hay trabajador de servicio', sw.estado === 200, `HTTP ${sw.estado}`);
comprobar('…y maneja `fetch`, que es lo que Chrome exige', sw.conFetch);

const registrado = await p.evaluate(async () => {
  for (let i = 0; i < 40; i += 1) {
    const r = await navigator.serviceWorker.getRegistration();
    if (r) return r.active?.state ?? r.installing?.state ?? 'registrado';
    await new Promise((s) => setTimeout(s, 250));
  }
  return null;
});
comprobar('se registra solo al abrir la página', Boolean(registrado), registrado ?? '');

// ---------------------------------------------------------------- iPhone --
const apple = await p.evaluate(() => ({
  capaz: Boolean(
    document.querySelector('meta[name="apple-mobile-web-app-capable"]') ??
      document.querySelector('meta[name="mobile-web-app-capable"]'),
  ),
  icono: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
  titulo:
    document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute('content') ?? null,
  barra:
    document
      .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.getAttribute('content') ?? null,
}));

comprobar('iPhone: se abre sin la barra de Safari', apple.capaz);
comprobar('iPhone: hay icono de pantalla de inicio', Boolean(apple.icono), apple.icono ?? '');
comprobar('iPhone: nombre bajo el icono', Boolean(apple.titulo), apple.titulo ?? '');
comprobar('iPhone: estilo de la barra de estado', Boolean(apple.barra), apple.barra ?? '');

await b.close();
console.log(
  problemas === 0
    ? '\nInstalable en Android y en iPhone.'
    : `\n${problemas} condiciones sin cumplir.`,
);
process.exit(problemas === 0 ? 0 : 1);
