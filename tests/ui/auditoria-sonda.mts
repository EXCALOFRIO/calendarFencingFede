/**
 * Sonda de auditoría visual que se engancha a cualquier arnés de capturas sin
 * tocarlo: se carga con `--import` y envuelve `chromium.launch` de Playwright.
 * Antes de cada `page.screenshot` mide la página tal como se va a capturar
 * (desbordes, objetivos táctiles, textos, contraste, chips, «Mundial», CLS y
 * primera pintura) y lo añade a `capturas/auditoria/medidas.jsonl`. Las
 * capturas que el arnés mande fuera de `capturas/auditoria/` se redirigen a
 * `capturas/auditoria/<arnés>/`.
 *
 *   $env:PERF_DB=...; $env:CAPTURAS='auditoria'; $env:PASADA='1'
 *   npx tsx --import ./tests/ui/auditoria-sonda.mts tests/ui/tanda1.mts
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const RAIZ = process.cwd();
// `SONDA_DIR` cambia la carpeta (y su medidas.jsonl) sin tocar la de la auditoría.
const AUDITORIA = path.join(RAIZ, 'capturas', process.env.SONDA_DIR ?? 'auditoria');
const ARNES = path.basename(process.argv[1] ?? 'arnes', '.mts');
const MEDIDAS = path.join(AUDITORIA, 'medidas.jsonl');
mkdirSync(AUDITORIA, { recursive: true });

// Se ejecuta en el navegador: no puede usar nada de fuera de la función.
async function medirEnPagina() {
  const vw = window.innerWidth;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    // 1x1 es el patrón de `sr-only`.
    if (r.width <= 1 || r.height <= 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const quien = (el: Element) => {
    const h = el as HTMLElement;
    const texto = (h.getAttribute('aria-label') ?? h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const slot = el.closest('[data-slot]')?.getAttribute('data-slot');
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ''} «${texto}» .${String(h.className?.baseVal ?? h.className ?? '').slice(0, 90)}`;
  };

  const lienzo = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgba = (c: string): [number, number, number, number] => {
    lienzo.clearRect(0, 0, 1, 1);
    lienzo.fillStyle = '#000';
    lienzo.fillStyle = c;
    lienzo.fillRect(0, 0, 1, 1);
    const d = lienzo.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const mezclar = (arriba: number[], abajo: number[]) => {
    const a = arriba[3]!;
    return [0, 1, 2].map((i) => arriba[i]! * a + abajo[i]! * (1 - a)).concat(1);
  };
  const fondoDe = (el: Element): { color: number[]; dudoso: boolean } => {
    const capas: number[][] = [];
    let dudoso = false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== 'none') dudoso = true;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) capas.push(c);
      if (c[3] >= 0.999) break;
    }
    let base = [255, 255, 255, 1];
    const raiz = rgba(getComputedStyle(document.body).backgroundColor);
    if (raiz[3] > 0) base = mezclar(raiz, base);
    for (const c of capas.reverse()) base = mezclar(c, base);
    return { color: base, dudoso };
  };
  const opacidad = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };

  const todos = [...document.querySelectorAll('body *')];

  const desborde = document.documentElement.scrollWidth - vw;
  const culpables = desborde > 0
    ? todos.filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 0.5)
      .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 0.5)
      .slice(0, 6).map((el) => `${Math.round(el.getBoundingClientRect().right - vw)}px ${quien(el)}`)
    : [];

  /*
   * Área táctil REAL: la caja del control o, si es mayor, su `::after`
   * transparente (`AREA_TACTIL` del sistema y la regla base de
   * `globals.css`), recortada por los antepasados con `overflow` distinto de
   * `visible`, que es donde se pierde. Un control que se ve de 32 px y se
   * toca en 44 no cuenta como pequeño; uno cuyo `::after` corta una fila
   * desplazable, sí.
   */
  const areaTactil = (el: Element) => {
    const r = el.getBoundingClientRect();
    let caja = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const tras = getComputedStyle(el, '::after');
    if (tras.content !== 'none' && tras.content !== 'normal' && tras.position === 'absolute') {
      const w = parseFloat(tras.width);
      const h = parseFloat(tras.height);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const aw = Math.max(r.width, w);
        const ah = Math.max(r.height, h);
        caja = { left: cx - aw / 2, top: cy - ah / 2, right: cx + aw / 2, bottom: cy + ah / 2 };
      }
    }
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      const x = s.overflowX !== 'visible';
      const y = s.overflowY !== 'visible';
      if (!x && !y) continue;
      const p = n.getBoundingClientRect();
      if (x) caja = { ...caja, left: Math.max(caja.left, p.left), right: Math.min(caja.right, p.right) };
      if (y) caja = { ...caja, top: Math.max(caja.top, p.top), bottom: Math.min(caja.bottom, p.bottom) };
    }
    return { width: Math.max(0, caja.right - caja.left), height: Math.max(0, caja.bottom - caja.top), visto: r };
  };

  const interactivos = document.querySelectorAll('a[href], button, [role=button], [role=tab], [role=link], [role=switch], [role=checkbox], [role=radio], input:not([type=hidden]), select, textarea, summary');
  const pequenos: string[] = [];
  let conAreaInvisible = 0;
  for (const el of interactivos) {
    if (!visible(el)) continue;
    const a = areaTactil(el);
    if (a.width >= 43.5 && a.height >= 43.5) {
      if (a.visto.width < 43.5 || a.visto.height < 43.5) conAreaInvisible += 1;
      continue;
    }
    // Un objetivo dentro de otro mayor ya cumple.
    const padre = el.parentElement?.closest('a[href], button, [role=button], [role=tab], label');
    if (padre) {
      const ap = areaTactil(padre);
      if (ap.height >= 43.5 && ap.width >= 43.5) continue;
    }
    pequenos.push(`${Math.round(a.width)}x${Math.round(a.height)} (se ve ${Math.round(a.visto.width)}x${Math.round(a.visto.height)}) ${quien(el)}`);
  }

  const hojas = todos.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0) && visible(el));
  const largos = hojas
    .map((el) => ({ el, t: (el.textContent ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((x) => x.t.length > 90 && !x.el.closest('table') && x.el.children.length < 4)
    .slice(0, 10).map((x) => `${x.t.length}c ${quien(x.el)}`);
  const cuenta = new Map<string, number>();
  for (const el of hojas) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t.length >= 6 && !/^[\d\s.,:/·–-]+$/.test(t)) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  }
  const repetidos = [...cuenta].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${n}× «${t.slice(0, 50)}»`);
  const palabras = (document.body.innerText.match(/\p{L}+/gu) ?? []).length;

  const contraste: string[] = [];
  let dudosos = 0;
  const vistos = new Set<string>();
  for (const el of hojas) {
    const s = getComputedStyle(el);
    const c = rgba(s.color);
    const op = opacidad(el);
    const f = fondoDe(el);
    const texto = mezclar([c[0], c[1], c[2], c[3] * op], f.color);
    const [a, b] = [lum(texto), lum(f.color)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const px = parseFloat(s.fontSize);
    const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    const minimo = grande ? 3 : 4.5;
    if (ratio >= minimo) continue;
    if (f.dudoso) { dudosos += 1; continue; }
    const clave = `${s.color}|${f.color.join()}|${px}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    contraste.push(`${ratio.toFixed(2)}:1 ${px}px ${quien(el)}`);
  }

  const truncados = todos.filter((el) => {
    if (!visible(el)) return false;
    const s = getComputedStyle(el);
    const h = el as HTMLElement;
    return (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') && (h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1);
  }).slice(0, 10).map(quien);

  const scrollX = todos.filter((el) => {
    const s = getComputedStyle(el);
    const h = el as HTMLElement;
    return visible(el) && /(auto|scroll)/.test(s.overflowX) && h.scrollWidth > h.clientWidth + 1;
  }).slice(0, 6).map((el) => {
    const h = el as HTMLElement;
    const r = h.getBoundingClientRect();
    const fuera = [...h.querySelectorAll('th, thead td')].filter((c) => c.getBoundingClientRect().left >= r.right - 2)
      .map((c) => (c.textContent ?? '').trim()).filter(Boolean).slice(0, 8);
    return `${h.scrollWidth}/${h.clientWidth}px ocultas[${fuera.join(',')}] ${quien(el)}`;
  });

  const chips = new Map<string, Set<string>>();
  for (const el of hojas) {
    const t = (el.textContent ?? '').trim();
    if (!/^(FIE|RFEE|EFC|JJOO|Solo JJOO|Ol[ií]mpic[oa]s?|Nacional|Internacional|Europeo|Mundial)$/i.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 48) continue;
    let caja: Element = el;
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (rgba(s.backgroundColor)[3] > 0 || parseFloat(s.borderTopWidth) > 0) { caja = n; break; }
    }
    const s = getComputedStyle(caja);
    const firma = `${caja.tagName.toLowerCase()} h${Math.round(caja.getBoundingClientRect().height)} fs${getComputedStyle(el).fontSize} r${s.borderTopLeftRadius} bg${rgba(s.backgroundColor).map((x) => Math.round(x * (x <= 1 ? 100 : 1))).join(',')} c${rgba(getComputedStyle(el).color).slice(0, 3).join(',')} b${s.borderTopWidth}`;
    const clave = t.toUpperCase();
    if (!chips.has(clave)) chips.set(clave, new Set());
    chips.get(clave)!.add(firma);
  }

  const mundial = hojas.map((el) => (el.textContent ?? '').trim()).filter((t) => /mundial/i.test(t)).slice(0, 8);
  const vacios = hojas.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => /^(Sin |No hay|Ningun|Todavía no|Aún no|Nada )/i.test(t)).slice(0, 6);

  const cls = await new Promise<number>((ok) => {
    let suma = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) suma += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    } catch { /* sin soporte */ }
    setTimeout(() => ok(Math.round(suma * 1000) / 1000), 150);
  });
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

  return {
    ancho: vw,
    alto: document.documentElement.scrollHeight,
    desborde,
    culpables,
    pequenos: pequenos.length,
    pequenosEj: [...new Set(pequenos)].slice(0, 12),
    conAreaInvisible,
    largos,
    repetidos,
    palabras,
    contraste: contraste.slice(0, 10),
    contrasteTotal: contraste.length,
    contrasteDudosos: dudosos,
    truncados,
    scrollX,
    chips: Object.fromEntries([...chips].map(([k, v]) => [k, [...v]])),
    mundial,
    vacios,
    cls,
    fcp: fcp === null ? null : Math.round(fcp),
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    kB: nav ? Math.round(nav.transferSize / 1024) : null,
  };
}

function rutaDestino(original: string | undefined): string | undefined {
  if (!original) return original;
  const abs = path.resolve(original);
  if (abs.startsWith(AUDITORIA + path.sep)) return abs;
  const destino = path.join(AUDITORIA, ARNES, path.basename(abs));
  mkdirSync(path.dirname(destino), { recursive: true });
  return destino;
}

function envolverPagina(pagina: Page): Page {
  const original = pagina.screenshot.bind(pagina);
  pagina.screenshot = (async (opciones: Parameters<Page['screenshot']>[0] = {}) => {
    const destino = rutaDestino(opciones.path);
    try {
      // tsx compila con keepNames y mete llamadas a `__name` que en el navegador no existen.
      await pagina.evaluate('window.__name = window.__name || ((f) => f)');
      const m = await pagina.evaluate(medirEnPagina);
      appendFileSync(MEDIDAS, `${JSON.stringify({ arnes: ARNES, captura: destino ? path.relative(RAIZ, destino) : null, url: pagina.url(), ...m })}\n`);
    } catch (e) {
      console.error('[sonda]', (e as Error).message);
    }
    return original({ ...opciones, path: destino });
  }) as Page['screenshot'];
  return pagina;
}

function envolverContexto(contexto: BrowserContext): BrowserContext {
  const nueva = contexto.newPage.bind(contexto);
  contexto.newPage = async () => envolverPagina(await nueva());
  return contexto;
}

// tsx puede evaluar este módulo dos veces (cargador ESM y CJS): se envuelve una sola.
const marca = Symbol.for('auditoria-sonda');
const lanzar = chromium.launch.bind(chromium);
if (!(chromium as unknown as Record<symbol, boolean>)[marca]) (chromium as unknown as Record<symbol, boolean>)[marca] = true, chromium.launch = (async (...args: Parameters<typeof chromium.launch>) => {
  const navegador: Browser = await lanzar(...args);
  const nuevaPagina = navegador.newPage.bind(navegador);
  const nuevoContexto = navegador.newContext.bind(navegador);
  navegador.newPage = async (o) => envolverPagina(await nuevaPagina(o));
  navegador.newContext = async (o) => envolverContexto(await nuevoContexto(o));
  return navegador;
}) as typeof chromium.launch;
