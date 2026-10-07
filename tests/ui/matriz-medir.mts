/**
 * Medida de una página en una variante de la matriz: abre un contexto con la
 * emulación del dispositivo (viewport, densidad, móvil/táctil, esquema de
 * color y texto al 130 %), recoge los errores de consola, mide en el navegador
 * y hace la captura. Las comprobaciones de desborde, táctiles y contraste son
 * las de `auditoria-sonda.mts`, ampliadas con solapes, recortes, controles
 * grandes, texto pequeño e imágenes sin tamaño.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import { UMBRALES, type Medida, type Registro, type Variante } from './matriz-config.mjs';

/** Alto máximo de la captura (las fichas largas pasan de 10 000 px). */
const ALTO_CAPTURA = 6000;

const FUENTES_EXTERNAS = /fonts\.(googleapis|gstatic)\.com/;

// Se ejecuta en el navegador: no puede usar nada de fuera de la función.
export async function medirEnPagina(u: { tactil: number; grande: number; texto: number; contraste: number; ancho?: number }): Promise<Medida> {
  // Con isMobile, Chromium ensancha el viewport de diseño hasta lo que ocupe la página (como un móvil de verdad):
  // innerWidth crece con el desborde y hay que comparar con el ancho del dispositivo.
  const vw = u.ancho ?? window.innerWidth;
  // Caras traseras de una tarjeta que gira (backface-visibility: hidden y vueltas de espaldas): no se ven.
  const espaldas = new Map<Element, boolean>();
  const deEspaldas = (el: Element): boolean => {
    if (espaldas.has(el)) return espaldas.get(el)!;
    let r = false;
    let cara: Element | null = null;
    for (let n: Element | null = el; n && !cara; n = n.parentElement) if (getComputedStyle(n).backfaceVisibility === 'hidden') cara = n;
    if (cara) {
      let m = new DOMMatrix();
      for (let n: Element | null = cara; n; n = n.parentElement) {
        const t = getComputedStyle(n).transform;
        if (t && t !== 'none') m = new DOMMatrix(t).multiply(m);
      }
      r = m.m33 < 0;
    }
    espaldas.set(el, r);
    return r;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    // 1x1 es el patrón de `sr-only`.
    if (r.width <= 1 || r.height <= 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !deEspaldas(el);
  };
  // Capa de un elemento: lo fijo o pegajoso (barras, hojas abiertas) se pinta encima del resto a propósito.
  const capa = (el: Element): Element | null => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky' || n.matches('[role=dialog], dialog')) return n;
    }
    return null;
  };
  const quien = (el: Element) => {
    const h = el as HTMLElement;
    const texto = (h.getAttribute('aria-label') ?? h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const cls = String((h.className as unknown as { baseVal?: string })?.baseVal ?? h.className ?? '').slice(0, 60);
    return `${el.tagName.toLowerCase()} «${texto}»${cls ? ` .${cls}` : ''}`;
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
    const raiz = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (raiz[3] > 0) base = mezclar(raiz, base);
    const cuerpo = rgba(getComputedStyle(document.body).backgroundColor);
    if (cuerpo[3] > 0) base = mezclar(cuerpo, base);
    for (const c of capas.reverse()) base = mezclar(c, base);
    return { color: base, dudoso };
  };
  const opacidad = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const tieneCaja = (el: Element) => {
    const s = getComputedStyle(el);
    return rgba(s.backgroundColor)[3] > 0.05 || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0 || s.boxShadow !== 'none';
  };
  const unicos = (xs: string[], n: number) => [...new Set(xs)].slice(0, n);

  const todos = [...document.querySelectorAll('body *')];

  const desborde = Math.max(0, document.documentElement.scrollWidth - vw);
  const culpables = desborde > 0
    ? todos.filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 0.5)
      .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 0.5)
      .slice(0, 6).map((el) => `${Math.round(el.getBoundingClientRect().right - vw)}px ${quien(el)}`)
    : [];

  // Hojas de texto con el rectángulo ajustado de sus propios nodos de texto.
  // `r` se ciñe a la caja que recorta el texto (para los solapes); `bruto` no (para ver lo cortado).
  const hojas: { el: Element; r: DOMRect; bruto: DOMRect }[] = [];
  const rango = document.createRange();
  for (const el of todos) {
    if (!visible(el)) continue;
    const nodos = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
    if (nodos.length === 0) continue;
    let izq = Infinity, arr = Infinity, der = -Infinity, abj = -Infinity;
    for (const n of nodos) {
      rango.selectNodeContents(n);
      for (const c of rango.getClientRects()) {
        if (c.width < 1 || c.height < 1) continue;
        izq = Math.min(izq, c.left); arr = Math.min(arr, c.top); der = Math.max(der, c.right); abj = Math.max(abj, c.bottom);
      }
    }
    if (izq === Infinity) continue;
    const bruto = new DOMRect(izq, arr + scrollY, der - izq, abj - arr);
    // Lo oculto por line-clamp o truncate sigue en los rectángulos del texto.
    for (const n of [el, el.parentElement]) {
      if (!n) continue;
      const sn = getComputedStyle(n);
      if (sn.overflowX === 'visible' && sn.overflowY === 'visible') continue;
      const c = n.getBoundingClientRect();
      izq = Math.max(izq, c.left); arr = Math.max(arr, c.top); der = Math.min(der, c.right); abj = Math.min(abj, c.bottom);
    }
    if (der - izq < 1 || abj - arr < 1) continue;
    hojas.push({ el, bruto, r: new DOMRect(izq, arr + scrollY, der - izq, abj - arr) });
  }

  // Solapes: dos hojas de texto que se pisan (sin ser una antepasada de la otra).
  const solapados: string[] = [];
  const cubos = new Map<number, number[]>();
  hojas.forEach((h, i) => {
    for (let k = Math.floor(h.r.top / 40); k <= Math.floor(h.r.bottom / 40); k++) cubos.set(k, [...(cubos.get(k) ?? []), i]);
  });
  const vistosSolape = new Set<string>();
  for (const idx of cubos.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const x = hojas[idx[a]!]!, y = hojas[idx[b]!]!;
        const par = `${idx[a]}-${idx[b]}`;
        if (vistosSolape.has(par)) continue;
        vistosSolape.add(par);
        if (x.el.contains(y.el) || y.el.contains(x.el)) continue;
        if (capa(x.el) !== capa(y.el)) continue;
        // El rectángulo de un nodo de texto es la caja de la fuente, más alta que la tinta: se compara su franja central.
        const ix = x.r.height * 0.25, iy = y.r.height * 0.25;
        const ancho = Math.min(x.r.right, y.r.right) - Math.max(x.r.left, y.r.left);
        const alto = Math.min(x.r.bottom - ix, y.r.bottom - iy) - Math.max(x.r.top + ix, y.r.top + iy);
        if (ancho <= 2 || alto <= 2) continue;
        const menor = Math.min(x.r.width * x.r.height, y.r.width * y.r.height) * 0.5;
        if (ancho * alto < 0.2 * menor) continue;
        solapados.push(`${quien(x.el)} ↔ ${quien(y.el)}`);
      }
    }
  }

  // Cortados: texto que se sale de un antepasado con overflow oculto (sin elipsis) o del borde izquierdo.
  const cortados: string[] = [];
  for (const { el, bruto: r } of hojas) {
    const top = r.top - scrollY;
    if (r.left < -1) { cortados.push(`${Math.round(-r.left)}px a la izquierda ${quien(el)}`); continue; }
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') continue;
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const sn = getComputedStyle(n);
      if (sn.position === 'fixed') break;
      const ox = sn.overflowX, oy = sn.overflowY;
      if (/(auto|scroll)/.test(ox) || /(auto|scroll)/.test(oy)) break;
      if (!/(hidden|clip)/.test(ox) && !/(hidden|clip)/.test(oy)) continue;
      if (sn.textOverflow === 'ellipsis' || sn.webkitLineClamp !== 'none') break;
      const c = n.getBoundingClientRect();
      const fueraX = /(hidden|clip)/.test(ox) && (r.right > c.right + 2 || r.left < c.left - 2);
      const fueraY = /(hidden|clip)/.test(oy) && (top + r.height > c.bottom + 2 || top < c.top - 2);
      // Lo que queda entero fuera es contenido plegado a propósito (acordeones, carruseles).
      const enteroFuera = r.right <= c.left || r.left >= c.right || top >= c.bottom || top + r.height <= c.top;
      if ((fueraX || fueraY) && !enteroFuera) cortados.push(`${fueraX ? 'ancho' : 'alto'} ${quien(el)}`);
      break;
    }
  }

  /*
   * Área táctil real, con el criterio de `auditoria-sonda.mts`: la caja del
   * control o, si es mayor, su `::after` transparente (`AREA_TACTIL` y la regla
   * base de `globals.css`), recortada por los antepasados con `overflow`
   * distinto de `visible`. En una zona desplazable se recorta como si se
   * hubiera desplazado lo justo para ver el control (`alVer`): una fila que
   * queda más abajo de una lista con scroll se alcanza desplazando, pero el
   * `::after` de un chip pegado al principio de su fila sí se pierde.
   */
  const alVer = (a: number, b: number, va: number, vb: number, desplazado: number, maximo: number) => {
    let d = 0;
    if (b > vb) d = b - vb;
    if (a < va + d) d = a - va;
    return Math.min(Math.max(d, -desplazado), Math.max(0, maximo - desplazado));
  };
  const areaTactil = (el: Element, r: DOMRect) => {
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
      if (x) {
        const d = /(auto|scroll)/.test(s.overflowX) ? alVer(r.left, r.right, p.left, p.right, n.scrollLeft, n.scrollWidth - n.clientWidth) : 0;
        caja = { ...caja, left: Math.max(caja.left, p.left + d), right: Math.min(caja.right, p.right + d) };
      }
      if (y) {
        const d = /(auto|scroll)/.test(s.overflowY) ? alVer(r.top, r.bottom, p.top, p.bottom, n.scrollTop, n.scrollHeight - n.clientHeight) : 0;
        caja = { ...caja, top: Math.max(caja.top, p.top + d), bottom: Math.min(caja.bottom, p.bottom + d) };
      }
    }
    return { width: Math.max(0, caja.right - caja.left), height: Math.max(0, caja.bottom - caja.top) };
  };

  // Objetivos táctiles y controles grandes.
  const selector = 'a[href], button, [role=button], [role=tab], [role=link], [role=switch], [role=checkbox], [role=radio], [role=menuitem], input:not([type=hidden]), select, textarea, summary';
  const tactiles: string[] = [];
  const grandes: string[] = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.parentElement?.closest(selector)) continue;
    const s = getComputedStyle(el);
    let r = el.getBoundingClientRect();
    let objetivo: Element = el;
    const etiqueta = el.closest('label');
    if (etiqueta && el.matches('input')) {
      const re = etiqueta.getBoundingClientRect();
      if (re.width * re.height > r.width * r.height) { r = re; objetivo = etiqueta; }
    }
    // Enlace dentro de un párrafo: WCAG 2.5.8 lo exime.
    const enLinea = s.display === 'inline' && el.parentElement && (el.parentElement.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 3;
    const area = areaTactil(objetivo, r);
    // Recortado entero por un antepasado (lo plegado bajo «Ver todo», por ejemplo): no se ve ni se toca.
    if (area.width < 1 || area.height < 1) continue;
    if (!enLinea && (area.width < u.tactil - 0.5 || area.height < u.tactil - 0.5)) {
      tactiles.push(`${Math.round(area.width)}x${Math.round(area.height)}${area.width !== r.width || area.height !== r.height ? ` (se ve ${Math.round(r.width)}x${Math.round(r.height)})` : ''} ${quien(el)}`);
    }

    if (el.matches('textarea, input[type=checkbox], input[type=radio]')) continue;
    const textoControl = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    let caja: Element | null = tieneCaja(el) ? el : null;
    if (!caja && el.children.length === 1 && tieneCaja(el.children[0]!)) caja = el.children[0]!;
    if (!caja) continue;
    const alto = caja.getBoundingClientRect().height;
    // Más de 120 px o mucho texto es una tarjeta enlazada, no un botón.
    if (alto > u.grande + 0.5 && alto <= 120 && textoControl.length <= 40) grandes.push(`${Math.round(alto)}px ${quien(el)}`);
  }

  // Texto pequeño y contraste.
  const pequenos: string[] = [];
  let pequenosTotal = 0;
  const contraste: string[] = [];
  let contrasteTotal = 0;
  const vistos = new Set<string>();
  for (const { el } of hojas) {
    if (el.closest('svg')) continue;
    const s = getComputedStyle(el);
    const px = parseFloat(s.fontSize);
    if (px < u.texto - 0.01) {
      pequenosTotal += 1;
      pequenos.push(`${px}px ${quien(el)}`);
    }
    const c = rgba(s.color);
    const f = fondoDe(el);
    if (f.dudoso) continue;
    const texto = mezclar([c[0], c[1], c[2], c[3] * opacidad(el)], f.color);
    const [a, b] = [lum(texto), lum(f.color)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio >= (grande ? 3 : u.contraste)) continue;
    const clave = `${s.color}|${f.color.join()}|${px}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    contrasteTotal += 1;
    contraste.push(`${ratio.toFixed(2)}:1 ${px}px ${quien(el)}`);
  }

  const truncados = todos.filter((el) => {
    if (!visible(el)) return false;
    const s = getComputedStyle(el);
    const h = el as HTMLElement;
    return (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') && (h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1);
  }).map(quien);

  const imagenes: string[] = [];
  for (const img of document.querySelectorAll('img')) {
    const fuente = (img.currentSrc || img.src || '').split('/').pop()?.slice(0, 50) ?? '';
    if (img.complete && img.naturalWidth === 0 && visible(img)) { imagenes.push(`rota ${fuente}`); continue; }
    const s = getComputedStyle(img);
    const conAtributos = img.hasAttribute('width') && img.hasAttribute('height');
    if (!conAtributos && s.aspectRatio === 'auto' && !(img.style.width && img.style.height)) imagenes.push(`sin width/height ${fuente}`);
  }

  const cls = await new Promise<number>((ok) => {
    let suma = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) suma += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    } catch { /* sin soporte */ }
    setTimeout(() => ok(Math.round(suma * 1000) / 1000), 150);
  });
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;

  return {
    ancho: vw,
    alto: document.documentElement.scrollHeight,
    desborde,
    culpables,
    cortados: unicos(cortados, 12),
    solapados: unicos(solapados, 12),
    tactiles: unicos(tactiles, 40),
    grandes: unicos(grandes, 40),
    textoPequeno: unicos(pequenos, 12),
    textoPequenoTotal: pequenosTotal,
    contraste: contraste.slice(0, 12),
    contrasteTotal,
    truncados: unicos(truncados, 12),
    imagenes: unicos(imagenes, 12),
    cls,
    fcp: fcp === null ? null : Math.round(fcp),
  };
}

/**
 * Guion que corre antes que el documento: el <html> aún no existe y se espera
 * a que el analizador lo cree. Va como texto para que tsx no le meta `__name`.
 * El texto grande multiplica el tamaño raíz que ya fija la hoja (16 px),
 * como haría el zoom de texto, antes de la primera pintura para no
 * contar como CLS; lo fijado en px no crece.
 */
export function guionPrevio(o: { texto: number; quitarOscuro: boolean }): string {
  return `(() => {
  const aplicar = () => {
    const h = document.documentElement;
    if (!h) return false;
    ${o.texto !== 100 ? `document.addEventListener('DOMContentLoaded', () => { const base = parseFloat(getComputedStyle(h).fontSize); h.style.setProperty('font-size', (base * ${o.texto / 100}) + 'px', 'important'); }, { once: true });` : ''}
    ${o.quitarOscuro ? "h.classList.remove('dark');" : ''}
    return true;
  };
  if (!aplicar()) {
    const obs = new MutationObserver(() => { if (aplicar()) obs.disconnect(); });
    obs.observe(document, { childList: true });
  }
})();`;
}

export type OpcionesMedida = {
  /** Carpeta base de capturas; null, no captura. */
  carpeta: string | null;
  raiz: string;
  /** Quita la clase `dark` del <html> en el tema claro (la app hoy sólo tiene tema oscuro). */
  forzarClaro?: boolean;
};

export async function medirVariante(navegador: Browser, url: string, v: Variante, base: Pick<Registro, 'alias' | 'pagina' | 'ruta'>, o: OpcionesMedida): Promise<Registro> {
  const inicio = Date.now();
  const contexto = await navegador.newContext({
    viewport: { width: v.ancho, height: v.alto },
    deviceScaleFactor: v.dpr,
    isMobile: v.movil,
    hasTouch: v.tactil,
    colorScheme: v.tema === 'claro' ? 'light' : 'dark',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  const consola: string[] = [];
  const registro: Registro = { ...base, variante: v.clave, tactil: v.tactil, captura: null, ms: 0, consola };
  try {
    await contexto.addInitScript({ content: guionPrevio({ texto: v.texto, quitarOscuro: v.tema === 'claro' && Boolean(o.forzarClaro) }) });
    const pagina = await contexto.newPage();
    pagina.on('console', (m) => {
      if (m.type() !== 'error' || FUENTES_EXTERNAS.test(m.location().url ?? '') || FUENTES_EXTERNAS.test(m.text())) return;
      consola.push(m.text().replace(/\s+/g, ' ').slice(0, 200));
    });
    pagina.on('pageerror', (e) => consola.push(`pageerror: ${e.message.slice(0, 200)}`));
    pagina.on('response', (r) => {
      if (r.status() >= 400 && !FUENTES_EXTERNAS.test(r.url())) consola.push(`${r.status()} ${new URL(r.url()).pathname.slice(0, 120)}`);
    });
    await pagina.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await pagina.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await pagina.evaluate(() => Promise.race([document.fonts.ready, new Promise((ok) => setTimeout(ok, 4000))]));
    await pagina.waitForTimeout(300);
    // tsx compila con keepNames y mete llamadas a `__name` que en el navegador no existen.
    await pagina.evaluate('window.__name = window.__name || ((f) => f)');
    registro.medida = await pagina.evaluate(medirEnPagina, { tactil: UMBRALES.tactil, grande: UMBRALES.grande, texto: UMBRALES.texto, contraste: UMBRALES.contraste, ancho: v.ancho });
    if (o.carpeta) {
      const destino = path.join(o.carpeta, v.clave, `${base.pagina}.png`);
      mkdirSync(path.dirname(destino), { recursive: true });
      const alto = Math.min(registro.medida.alto, ALTO_CAPTURA);
      await pagina.screenshot({ path: destino, fullPage: true, scale: 'css', clip: { x: 0, y: 0, width: v.ancho, height: Math.max(alto, 1) }, timeout: 60_000 });
      registro.captura = path.relative(o.raiz, destino);
    }
  } catch (e) {
    registro.error = (e as Error).message.split('\n')[0]!.slice(0, 300);
  } finally {
    registro.ms = Date.now() - inicio;
    await contexto.close().catch(() => {});
  }
  return registro;
}
