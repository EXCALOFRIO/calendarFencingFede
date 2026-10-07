/**
 * Gancho de la auditoría de accesibilidad: se carga con `--import` en un arnés
 * de capturas sin tocarlo (como `matriz-gancho.mts`) y envuelve
 * `chromium.launch`. La primera vez que el arnés abre una ruta de su servidor
 * que encaja con A11Y_PAGINAS, la audita en contextos nuevos del mismo
 * navegador y añade una línea JSON por variante a A11Y_SALIDA:
 *
 *  - movil       393×852 táctil: axe-core (WCAG 2.0/2.1/2.2 A y AA + buenas
 *                prácticas) y las sondas propias (estructura, landmarks, barra,
 *                foco con Tab, tablas, avisos, imágenes, clicables sin teclado);
 *  - escritorio  1280×800: lo mismo;
 *  - zoom200     1280×800 al 200 % (640×400 a 2×): reflujo, recortes y foco tapado;
 *  - texto200    393×852 con el texto raíz al 200 %: recortes y desborde;
 *  - quieto      393×852 con prefers-reduced-motion: animaciones que siguen vivas.
 *
 * La app sólo tiene tema oscuro (`<html class="dark">`), así que no hay variante clara.
 * AXE_JS apunta a `axe.min.js` (por defecto %TEMP%\a11y-axe\node_modules\axe-core\axe.min.js).
 * Las capturas propias del arnés no se escriben.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const RAIZ = process.cwd();
const ALIAS = process.env.A11Y_ALIAS ?? path.basename(process.argv[1] ?? 'arnes', '.mts');
const PAGINAS = new RegExp(process.env.A11Y_PAGINAS ?? '.');
const SALIDA = process.env.A11Y_SALIDA ?? path.join(RAIZ, 'capturas', 'a11y', 'medidas', `${ALIAS}.jsonl`);
const AXE_JS = process.env.AXE_JS ?? path.join(tmpdir(), 'a11y-axe', 'node_modules', 'axe-core', 'axe.min.js');
const VARIANTES = (process.env.A11Y_VARIANTES ?? 'movil,escritorio,zoom200,texto200,quieto').split(',').map((s) => s.trim()).filter(Boolean);
const LISTAR = Boolean(process.env.A11Y_LISTAR);
const MAX_TABS = Number(process.env.A11Y_TABS ?? 90);
if (!existsSync(AXE_JS)) throw new Error(`no está axe-core en ${AXE_JS} (npm install axe-core --prefix %TEMP%\\a11y-axe)`);
mkdirSync(path.dirname(SALIDA), { recursive: true });

type Variante = { clave: string; ancho: number; alto: number; dpr: number; tactil: boolean; texto: number; quieto: boolean; axe: boolean; sondas: boolean; tabs: boolean };
const TODAS: Record<string, Variante> = {
  movil: { clave: 'movil', ancho: 393, alto: 852, dpr: 3, tactil: true, texto: 100, quieto: false, axe: true, sondas: true, tabs: true },
  escritorio: { clave: 'escritorio', ancho: 1280, alto: 800, dpr: 1, tactil: false, texto: 100, quieto: false, axe: true, sondas: true, tabs: true },
  zoom200: { clave: 'zoom200', ancho: 640, alto: 400, dpr: 2, tactil: false, texto: 100, quieto: false, axe: false, sondas: false, tabs: true },
  texto200: { clave: 'texto200', ancho: 393, alto: 852, dpr: 3, tactil: true, texto: 200, quieto: false, axe: false, sondas: false, tabs: false },
  quieto: { clave: 'quieto', ancho: 393, alto: 852, dpr: 3, tactil: true, texto: 100, quieto: true, axe: false, sondas: false, tabs: false },
};

const guionPrevio = (texto: number) => `(() => {
  window.__name = window.__name || ((f) => f);
  ${texto !== 100 ? `document.addEventListener('DOMContentLoaded', () => { const h = document.documentElement; const base = parseFloat(getComputedStyle(h).fontSize); h.style.setProperty('font-size', (base * ${texto / 100}) + 'px', 'important'); }, { once: true });` : ''}
})();`;

// ------------------------------------------------------------------ sondas en el navegador

/** Descripción corta de un elemento para localizarlo en el código. */
function sondas(o: { ancho: number }) {
  const quien = (el: Element | null): string => {
    if (!el) return '(nada)';
    const h = el as HTMLElement;
    const slot = h.closest('[data-slot]')?.getAttribute('data-slot');
    const nombre = (h.getAttribute('aria-label') ?? h.getAttribute('title') ?? h.getAttribute('alt') ?? h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const cls = (typeof h.className === 'string' ? h.className : h.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    const href = h.getAttribute('href');
    return `${el.tagName.toLowerCase()}${h.getAttribute('role') ? `[role=${h.getAttribute('role')}]` : ''}${href ? `[href=${href.slice(0, 60)}]` : ''} «${nombre}»${slot ? ` {${slot}}` : ''}${cls ? ` .${cls}` : ''}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const oculto = (el: Element) => Boolean(el.closest('[aria-hidden="true"], [hidden], [inert]'));

  const encabezados = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
    .filter((e) => visible(e) || e.classList.contains('sr-only'))
    .map((e) => ({ nivel: Number(e.getAttribute('aria-level') ?? e.tagName.slice(1)) || 2, texto: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), srOnly: e.classList.contains('sr-only') }));
  const saltos: string[] = [];
  for (let i = 1; i < encabezados.length; i++) {
    if (encabezados[i]!.nivel > encabezados[i - 1]!.nivel + 1) saltos.push(`h${encabezados[i - 1]!.nivel} «${encabezados[i - 1]!.texto}» → h${encabezados[i]!.nivel} «${encabezados[i]!.texto}»`);
  }

  const landmark = (sel: string) => [...document.querySelectorAll(sel)].filter((e) => !oculto(e)).map((e) => quien(e).slice(0, 90));
  const landmarks = {
    main: landmark('main,[role=main]'),
    nav: [...document.querySelectorAll('nav,[role=navigation]')].map((e) => `${e.getAttribute('aria-label') ?? '(sin etiqueta)'} ${visible(e) ? '' : '(oculta)'}`),
    banner: landmark('body > header, body > * > header:not(main header):not(article header):not(section header), [role=banner]'),
    contentinfo: landmark('footer:not(main footer):not(article footer), [role=contentinfo]'),
    search: landmark('[role=search], search, form[role=search]'),
  };

  const barras = [...document.querySelectorAll('nav,[role=navigation]')].filter(visible).map((n) => {
    const enlaces = [...n.querySelectorAll('a,button')].filter(visible);
    return {
      etiqueta: n.getAttribute('aria-label') ?? '(sin etiqueta)',
      enlaces: enlaces.map((a) => `${(a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 25)}${a.getAttribute('aria-current') ? `[aria-current=${a.getAttribute('aria-current')}]` : ''}${a.getAttribute('aria-selected') ? `[aria-selected=${a.getAttribute('aria-selected')}]` : ''}${a.getAttribute('data-activo') !== null || a.getAttribute('data-state') === 'active' ? '[marca-visual]' : ''}`),
      conCurrent: enlaces.filter((a) => a.hasAttribute('aria-current')).length,
    };
  });

  // Pestañas y segmentos sin role=tab ni aria-current/aria-pressed: estado sólo visual.
  const pestanasSinEstado = [...document.querySelectorAll('[role=tablist], [data-slot*=segment], [data-slot*=pestana], [data-slot*=tira]')]
    .filter(visible)
    .flatMap((l) => {
      const items = [...l.querySelectorAll('a,button')].filter(visible);
      const conEstado = items.filter((a) => ['aria-current', 'aria-selected', 'aria-pressed', 'aria-checked'].some((x) => a.hasAttribute(x)) || a.getAttribute('data-state'));
      return items.length > 1 && conEstado.length === 0 ? [`${quien(l).slice(0, 100)} (${items.length} opciones)`] : [];
    });

  const tablas = [...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible).map((t) => ({
    que: quien(t).slice(0, 80),
    filas: t.querySelectorAll('tr,[role=row]').length,
    th: t.querySelectorAll('th,[role=columnheader],[role=rowheader]').length,
    thScope: t.querySelectorAll('th[scope]').length,
    caption: Boolean(t.querySelector('caption')) || t.hasAttribute('aria-label') || t.hasAttribute('aria-labelledby'),
  }));
  // Rejillas CSS que se leen como tabla (≥ 4 columnas, ≥ 12 hijos) y no lo son para el lector.
  const pseudoTablas = [...document.querySelectorAll('div,ol,ul,section')]
    .filter((e) => {
      if (e.closest('table,[role=table],[role=grid]') || !visible(e)) return false;
      const s = getComputedStyle(e);
      if (s.display !== 'grid' && s.display !== 'inline-grid') return false;
      const cols = s.gridTemplateColumns.split(' ').filter(Boolean).length;
      return cols >= 4 && e.children.length >= 12;
    })
    .slice(0, 8)
    .map((e) => `${quien(e).slice(0, 110)} (${getComputedStyle(e).gridTemplateColumns.split(' ').length} col, ${e.children.length} celdas)`);

  const vivos = [...document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log],[aria-busy]')].map((e) => `${quien(e).slice(0, 80)} live=${e.getAttribute('aria-live') ?? e.getAttribute('role')}`);

  const imagenes = [...document.querySelectorAll('img')].map((i) => ({ src: (i.getAttribute('src') ?? '').split('/').pop()!.slice(0, 40), alt: i.getAttribute('alt'), oculto: oculto(i), visible: visible(i), que: quien(i.parentElement).slice(0, 60) }));
  const svgs = [...document.querySelectorAll('svg')].filter((s) => !oculto(s) && visible(s) && !s.closest('svg svg'));
  const svgSinNombre = svgs.filter((s) => {
    const nombre = s.getAttribute('aria-label') || s.getAttribute('aria-labelledby') || s.querySelector('title');
    const enControlConNombre = s.closest('a,button,[role=button]');
    return !nombre && s.getAttribute('role') !== 'presentation' && s.getAttribute('role') !== 'none' && !enControlConNombre && !s.closest('[aria-label]');
  }).slice(0, 15).map((s) => `svg ${s.getAttribute('class')?.split(' ').slice(0, 3).join('.') ?? ''} en ${quien(s.parentElement).slice(0, 80)}`);
  const svgImg = svgs.filter((s) => s.getAttribute('role') === 'img').map((s) => `${s.getAttribute('aria-label') ?? s.querySelector('title')?.textContent ?? '(sin nombre)'}`);

  const focusables = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=true]';
  const tabindexPositivo = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).map(quien).slice(0, 10);
  // Cosas con cursor de mano que el teclado no alcanza.
  const clicablesSinTeclado = [...document.querySelectorAll('body *')].filter((e) => {
    if (!visible(e) || oculto(e) || e.matches(focusables) || e.closest(focusables) || e.closest('label')) return false;
    if (getComputedStyle(e).cursor !== 'pointer') return false;
    const padre = e.parentElement;
    return !padre || getComputedStyle(padre).cursor !== 'pointer';
  }).slice(0, 15).map(quien);

  // Objetivos < 24 px (2.5.8) sin el ::after que amplía el área táctil del sistema.
  const pequenos: string[] = [];
  let pequenosTotal = 0;
  for (const el of document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],input:not([type=hidden]),select,summary')) {
    if (!visible(el) || oculto(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    const despues = getComputedStyle(el, '::after');
    if (despues.content !== 'none' && despues.position === 'absolute') {
      const w = parseFloat(despues.width), hh = parseFloat(despues.height);
      if (w >= 24 && hh >= 24) continue;
    }
    // Enlaces en línea dentro de un párrafo: excepción de 2.5.8.
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && (el.parentElement?.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 20) continue;
    pequenosTotal++;
    if (pequenos.length < 12) pequenos.push(`${Math.round(r.width)}×${Math.round(r.height)} ${quien(el)}`);
  }

  const desborde = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const temas = { html: document.documentElement.className, lang: document.documentElement.lang, titulo: document.title };
  const zoomBloqueado = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
  return { o, temas, zoomBloqueado, encabezados, h1: encabezados.filter((e) => e.nivel === 1).map((e) => e.texto), saltos, landmarks, barras, pestanasSinEstado, tablas, pseudoTablas, vivos, imagenes, svgSinNombre, svgImg, tabindexPositivo, clicablesSinTeclado, pequenos, pequenosTotal, desborde };
}

function estadoFoco() {
  // Va dentro: las funciones se serializan al navegador una a una.
  const huellaFoco = (e: Element) => {
    const s = getComputedStyle(e);
    const a = getComputedStyle(e, '::after');
    const b = getComputedStyle(e, '::before');
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.textDecorationLine, a.outlineStyle, a.boxShadow, a.borderColor, a.backgroundColor, b.boxShadow, b.backgroundColor, b.outlineStyle].join('|');
  };
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  // Las transiciones de foco empiezan en el valor sin foco: se adelantan al final.
  for (const a of el.getAnimations({ subtree: true })) { try { a.finish(); } catch { /* infinita */ } }
  if (!el.dataset.a11yI) el.dataset.a11yI = String(document.querySelectorAll('[data-a11y-i]').length);
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const nombre = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const slot = el.closest('[data-slot]')?.getAttribute('data-slot');
  const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
  const que = `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('href') ? `[href=${el.getAttribute('href')!.slice(0, 50)}]` : ''} «${nombre}»${slot ? ` {${slot}}` : ''}${cls ? ` .${cls}` : ''}`;
  const invisible = r.width < 1 || r.height < 1 || s.visibility === 'hidden' || Number(s.opacity) === 0 || r.right < 0 || r.left > innerWidth + 1 || Boolean(el.closest('[aria-hidden="true"]'));
  // Foco tapado (2.4.11): ningún punto del elemento queda encima de lo demás.
  let tapado = false;
  let tapa = '';
  if (!invisible) {
    const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]].map(([x, y]) => [Math.min(innerWidth - 1, Math.max(0, r.left + r.width * x!)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height * y!))]);
    const encima = pts.map(([x, y]) => document.elementFromPoint(x!, y!));
    const propios = encima.filter((e) => e && (el.contains(e) || e.contains(el)));
    if (propios.length === 0 && (r.bottom > 0 && r.top < innerHeight)) {
      tapado = true;
      const otro = encima.find(Boolean) as HTMLElement | undefined;
      tapa = otro ? `${otro.tagName.toLowerCase()} {${otro.closest('[data-slot]')?.getAttribute('data-slot') ?? ''}} .${(typeof otro.className === 'string' ? otro.className : '').split(' ').slice(0, 3).join('.')}` : '';
    }
  }
  const enDialogo = Boolean(el.closest('[role=dialog],[role=alertdialog]'));
  return { i: el.dataset.a11yI, que, x: Math.round(r.left), y: Math.round(r.top + scrollY), invisible, tapado, tapa, enDialogo, huella: huellaFoco(el), focusVisible: el.matches(':focus-visible') };
}

async function recorrerTab(pagina: Page, max: number) {
  const pasos: NonNullable<Awaited<ReturnType<typeof estadoFoco>>>[] = [];
  const vistos = new Set<string>();
  await pagina.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  let vueltas = 0;
  for (let n = 0; n < max; n++) {
    await pagina.keyboard.press('Tab');
    const e = await pagina.evaluate(estadoFoco);
    if (!e) { vueltas++; if (vueltas > 1) break; continue; }
    if (vistos.has(e.i!)) break;
    vistos.add(e.i!);
    pasos.push(e);
  }
  // Huella sin foco: el mismo elemento con el foco en ninguna parte.
  await pagina.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pagina.mouse.move(1, 1);
  await pagina.waitForTimeout(400);
  const sinFoco = await pagina.evaluate((ids: string[]) => {
    const huella = (el: Element) => {
      const s = getComputedStyle(el);
      const a = getComputedStyle(el, '::after');
      const b = getComputedStyle(el, '::before');
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color, s.textDecorationLine, a.outlineStyle, a.boxShadow, a.borderColor, a.backgroundColor, b.boxShadow, b.backgroundColor, b.outlineStyle].join('|');
    };
    return ids.map((i) => {
      const el = document.querySelector(`[data-a11y-i="${i}"]`);
      if (!el) return '';
      for (const a of el.getAnimations({ subtree: true })) { try { a.finish(); } catch { /* infinita */ } }
      return huella(el);
    });
  }, pasos.map((p) => p.i!));
  const sinIndicador = pasos.filter((p, k) => !p.invisible && p.huella === sinFoco[k]);
  // Saltos hacia arriba de más de una pantalla en el orden de Tab.
  const atras: string[] = [];
  for (let k = 1; k < pasos.length; k++) if (pasos[k - 1]!.y - pasos[k]!.y > 400) atras.push(`${pasos[k - 1]!.que.slice(0, 50)} (y=${pasos[k - 1]!.y}) → ${pasos[k]!.que.slice(0, 50)} (y=${pasos[k]!.y})`);
  return {
    total: pasos.length,
    completo: pasos.length < max,
    primeros: pasos.slice(0, 12).map((p) => p.que.slice(0, 80)),
    invisibles: pasos.filter((p) => p.invisible).map((p) => p.que.slice(0, 110)),
    tapados: pasos.filter((p) => p.tapado).map((p) => `${p.que.slice(0, 80)} bajo ${p.tapa.slice(0, 70)}`),
    sinIndicador: sinIndicador.map((p) => p.que.slice(0, 110)),
    atras,
    enDialogo: pasos.map((p) => p.enDialogo),
  };
}

async function correrAxe(pagina: Page) {
  await pagina.addScriptTag({ path: AXE_JS });
  return pagina.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; help: string; tags: string[]; nodes: { target: string[]; html: string; failureSummary: string }[] }[]; incomplete: { id: string; nodes: unknown[] }[] }> } }).axe;
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations', 'incomplete'],
    });
    return {
      violaciones: r.violations.map((v) => ({
        id: v.id, impacto: v.impact, ayuda: v.help, wcag: v.tags.filter((t) => /^wcag\d+$/.test(t)),
        nodos: v.nodes.length,
        ejemplos: v.nodes.slice(0, 6).map((n) => ({ selector: n.target.join(' '), html: n.html.slice(0, 220), motivo: n.failureSummary.replace(/\s+/g, ' ').slice(0, 260) })),
      })),
      incompletos: r.incomplete.map((v) => ({ id: v.id, nodos: v.nodes.length })),
    };
  });
}

/** Recortes con el texto grande o con zoom: contenido que se pierde. */
function recortes() {
  const quien = (el: Element) => {
    const slot = el.closest('[data-slot]')?.getAttribute('data-slot');
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    return `${el.tagName.toLowerCase()} «${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}»${slot ? ` {${slot}}` : ''}${cls ? ` .${cls}` : ''}`;
  };
  const truncados: string[] = [];
  const cortados: string[] = [];
  let truncadosTotal = 0;
  for (const el of document.querySelectorAll('body *')) {
    const h = el as HTMLElement;
    if (!h.textContent?.trim() || h.children.length > 3) continue;
    const s = getComputedStyle(h);
    if (s.display === 'none' || s.visibility === 'hidden' || h.closest('[aria-hidden="true"]')) continue;
    const r = h.getBoundingClientRect();
    // Lo .sr-only mide 1 px y recorta a propósito.
    if (r.width <= 2 || r.height <= 2 || h.closest('.sr-only')) continue;
    const ancho = h.scrollWidth > h.clientWidth + 1;
    const alto = h.scrollHeight > h.clientHeight + 1;
    const oculta = (v: string) => v === 'hidden' || v === 'clip';
    if ((ancho && oculta(s.overflowX)) || (alto && oculta(s.overflowY) && s.webkitLineClamp !== 'none')) {
      if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) {
        truncadosTotal++;
        if (truncados.length < 15) truncados.push(quien(h));
      } else if (cortados.length < 15) cortados.push(quien(h));
    }
  }
  const desborde = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // Culpables del desborde: lo que se sale por la derecha y cuyo padre no.
  const culpables: string[] = [];
  if (desborde > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const p = el.parentElement?.getBoundingClientRect();
      if (r.width > 0 && r.right > innerWidth + 1 && p && r.right > p.right + 1 && culpables.length < 6) culpables.push(`${quien(el)} (${Math.round(r.right - innerWidth)} px)`);
    }
  }
  // Fijos que se comen la pantalla con zoom (cabeceras + barra).
  let fijos = 0;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width > innerWidth * 0.6 && r.height < innerHeight && r.height > 0 && (r.top <= 1 || r.bottom >= innerHeight - 1)) fijos += Math.min(r.height, innerHeight);
  }
  return { desborde, culpables, truncados, truncadosTotal, cortados, fijosPx: Math.round(fijos), alto: innerHeight };
}

function movimientoVivo() {
  const vivas = document.getAnimations()
    .filter((a) => a.playState === 'running')
    .map((a) => {
      const t = a.effect?.getComputedTiming();
      const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return { nombre: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'web-animation', ms: Number(t?.duration ?? 0), iter: t?.iterations ?? 1, en: el ? `${el.tagName.toLowerCase()} .${(el.getAttribute('class') ?? '').split(' ').slice(0, 4).join('.')}` : '' };
    })
    .filter((a) => a.ms > 10 || a.iter === Infinity);
  const infinitas = [...document.querySelectorAll('body *')].filter((e) => {
    const s = getComputedStyle(e);
    return s.animationName !== 'none' && s.animationIterationCount === 'infinite' && parseFloat(s.animationDuration) > 0.01;
  }).slice(0, 10).map((e) => `${e.tagName.toLowerCase()} .${(e.getAttribute('class') ?? '').split(' ').slice(0, 4).join('.')}`);
  const suave = getComputedStyle(document.documentElement).scrollBehavior;
  return { vivas: vivas.slice(0, 15), infinitas, scrollSuave: suave };
}

// ------------------------------------------------------------------ una variante

async function auditar(nuevoContexto: Browser['newContext'], url: string, ruta: string, v: Variante) {
  const inicio = Date.now();
  const contexto: BrowserContext = await nuevoContexto({
    viewport: { width: v.ancho, height: v.alto },
    deviceScaleFactor: v.dpr,
    isMobile: v.tactil,
    hasTouch: v.tactil,
    colorScheme: 'dark',
    reducedMotion: v.quieto ? 'reduce' : 'no-preference',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  const r: Record<string, unknown> = { alias: ALIAS, ruta, variante: v.clave };
  try {
    await contexto.addInitScript({ content: guionPrevio(v.texto) });
    const pagina = await contexto.newPage();
    await pagina.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await pagina.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await pagina.evaluate(() => Promise.race([document.fonts.ready, new Promise((ok) => setTimeout(ok, 3000))]));
    await pagina.waitForTimeout(v.quieto ? 800 : 300);
    await pagina.evaluate('window.__name = window.__name || ((f) => f)');
    if (v.sondas) r.sondas = await pagina.evaluate(sondas, { ancho: v.ancho });
    if (v.axe) r.axe = await correrAxe(pagina);
    if (v.texto !== 100 || v.clave === 'zoom200') r.recortes = await pagina.evaluate(recortes);
    if (v.quieto) r.movimiento = await pagina.evaluate(movimientoVivo);
    if (v.tabs) {
      r.tab = await recorrerTab(pagina, MAX_TABS);
      // Con un diálogo abierto: Escape lo cierra y el foco no se escapa.
      const dialogo = await pagina.locator('[role=dialog]:visible').count();
      if (dialogo > 0) {
        await pagina.keyboard.press('Escape');
        await pagina.waitForTimeout(400);
        r.dialogo = { abiertos: dialogo, cierraConEscape: (await pagina.locator('[role=dialog]:visible').count()) === 0 };
      }
    }
  } catch (e) {
    r.error = (e as Error).message.split('\n')[0]!.slice(0, 300);
  } finally {
    r.ms = Date.now() - inicio;
    await contexto.close().catch(() => {});
  }
  return r;
}

const hechas = new Set<string>();

async function correr(nuevoContexto: Browser['newContext'], url: string) {
  const u = new URL(url);
  const ruta = `${u.pathname}${u.search}`;
  if (hechas.has(ruta)) return;
  hechas.add(ruta);
  if (LISTAR) { console.error(`[a11y] ruta ${ruta} ${PAGINAS.test(ruta) ? 'ENTRA' : '-'}`); return; }
  if (!PAGINAS.test(ruta)) return;
  const inicio = Date.now();
  for (const clave of VARIANTES) {
    const v = TODAS[clave];
    if (!v) throw new Error(`variante desconocida: ${clave}`);
    const r = await auditar(nuevoContexto, url, ruta, v);
    appendFileSync(SALIDA, `${JSON.stringify(r)}\n`);
    if (r.error) console.error(`[a11y] ${ruta} @${clave}: ${r.error}`);
  }
  console.error(`[a11y] ${ruta}: ${VARIANTES.length} variantes en ${Math.round((Date.now() - inicio) / 1000)} s`);
}

function envolverPagina(pagina: Page, nuevoContexto: Browser['newContext']): Page {
  const ir = pagina.goto.bind(pagina);
  pagina.goto = (async (url: string, opciones?: Parameters<Page['goto']>[1]) => {
    const respuesta = await ir(url, opciones);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      try {
        await correr(nuevoContexto, url);
      } catch (e) {
        console.error('[a11y]', (e as Error).message);
      }
    }
    return respuesta;
  }) as Page['goto'];
  pagina.screenshot = (async () => Buffer.alloc(0)) as Page['screenshot'];
  return pagina;
}

const marca = Symbol.for('a11y-gancho');
const registro = chromium as unknown as Record<symbol, boolean>;
if (!registro[marca]) {
  registro[marca] = true;
  const lanzar = chromium.launch.bind(chromium);
  chromium.launch = (async (...args: Parameters<typeof chromium.launch>) => {
    const navegador: Browser = await lanzar(...args);
    const nuevaPagina = navegador.newPage.bind(navegador);
    const nuevoContexto = navegador.newContext.bind(navegador);
    navegador.newPage = async (o) => envolverPagina(await nuevaPagina(o), nuevoContexto);
    navegador.newContext = async (o) => {
      const contexto: BrowserContext = await nuevoContexto(o);
      const nueva = contexto.newPage.bind(contexto);
      contexto.newPage = async () => envolverPagina(await nueva(), nuevoContexto);
      return contexto;
    };
    return navegador;
  }) as typeof chromium.launch;
}
