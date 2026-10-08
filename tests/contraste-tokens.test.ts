import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contraste de los tokens del tema, leídos de `src/app/globals.css`.
 *
 * Sin navegador: los tokens están en hexadecimal y `rgba()`, así que la
 * razón de WCAG se calcula aquí mismo. `tests/ui/contraste.mts` hace la
 * medida en Chrome (con la cascada real) cuando hay servidor.
 */

type Rgba = { r: number; g: number; b: number; a: number };

const css = readFileSync('src/app/globals.css', 'utf8');
const raiz = css.slice(css.indexOf(':root {'), css.indexOf('@theme inline'));
const sinComentarios = raiz.replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = new Map<string, string>();
for (const m of sinComentarios.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());

function color(nombre: string): Rgba {
  const v = tokens.get(nombre);
  if (!v) throw new Error(`No existe ${nombre} en :root`);
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(v);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: +rgba[4] };
  throw new Error(`${nombre} no es hexadecimal ni rgba(): ${v}`);
}

const encima = (capa: Rgba, base: Rgba): Rgba => ({
  r: capa.r * capa.a + base.r * (1 - capa.a),
  g: capa.g * capa.a + base.g * (1 - capa.a),
  b: capa.b * capa.a + base.b * (1 - capa.a),
  a: 1,
});

const lineal = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminancia = (c: Rgba) => 0.2126 * lineal(c.r) + 0.7152 * lineal(c.g) + 0.0722 * lineal(c.b);
function razon(a: Rgba, b: Rgba): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function aOklab(c: Rgba): [number, number, number] {
  const [R, G, B] = [lineal(c.r), lineal(c.g), lineal(c.b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function deOklab([L, a, b]: [number, number, number]): Rgba {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const g = (v: number) => {
    const x = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, x)) * 255);
  };
  return {
    r: g(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: g(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: g(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}
/** `color-mix(in oklab, color p, base)`. */
function mezclaOklab(c: Rgba, base: Rgba, p: number): Rgba {
  const A = aOklab(c);
  const B = aOklab(base);
  return deOklab([0, 1, 2].map((i) => A[i] * p + B[i] * (1 - p)) as [number, number, number]);
}

const SUPERFICIES = ['--background', '--card', '--popover', '--secondary', '--muted', '--accent'];
const TEXTOS = [
  '--foreground',
  '--card-foreground',
  '--popover-foreground',
  '--secondary-foreground',
  '--accent-foreground',
  '--muted-foreground',
  '--off',
  '--primary-text',
  '--destructive',
  '--gold',
  '--ok',
  '--warn',
  '--danger',
  '--org-rfee',
  '--org-fie',
  '--org-efc',
  '--org-aut',
];

function pares(textos: string[], fondos: string[], minimo: number) {
  const fallos: string[] = [];
  for (const t of textos)
    for (const f of fondos) {
      const r = razon(color(t), color(f));
      if (r < minimo) fallos.push(`${t} sobre ${f}: ${r.toFixed(2)}:1`);
    }
  return fallos;
}

describe('tokens del tema: un solo sistema de color', () => {
  it('lo opaco va en hexadecimal y lo translúcido en rgba(); nada de oklch en :root', () => {
    expect(sinComentarios).not.toMatch(/oklch\(|color-mix\(/);
    for (const [nombre, valor] of tokens) {
      if (!/^#|^rgba\(/.test(valor)) continue;
      expect(() => color(nombre), nombre).not.toThrow();
    }
  });

  it('las superficies son opacas y suben de luminancia por nivel', () => {
    for (const s of [...SUPERFICIES, '--marcado', '--cristal-solido']) expect(color(s).a, s).toBe(1);
    const L = (n: string) => luminancia(color(n));
    expect(L('--background')).toBeLessThan(L('--card'));
    expect(L('--card')).toBeLessThan(L('--popover'));
    expect(L('--popover')).toBeLessThan(L('--secondary'));
    expect(L('--secondary')).toBeLessThan(L('--accent'));
    expect(tokens.get('--muted')).toBe(tokens.get('--secondary'));
  });
});

describe('contraste AA de texto (4,5:1)', () => {
  it('cada token de texto sobre cada superficie', () => {
    expect(pares(TEXTOS, SUPERFICIES, 4.5)).toEqual([]);
  });

  it('el control marcado: rótulo rojo, blanco y apagado sobre --marcado', () => {
    expect(pares(['--primary-text', '--foreground', '--muted-foreground'], ['--marcado'], 4.5)).toEqual([]);
  });

  it('rellenos sólidos con su texto', () => {
    expect(razon(color('--primary-foreground'), color('--primary'))).toBeGreaterThanOrEqual(4.5);
    expect(razon(color('--gold-foreground'), color('--gold'))).toBeGreaterThanOrEqual(4.5);
    for (const o of ['rfee', 'fie', 'efc', 'aut'])
      expect(razon(color('--foreground'), color(`--org-${o}-relleno`)), o).toBeGreaterThanOrEqual(4.5);
  });

  it('tintes opacos: su color y el blanco encima, y siguen siendo la mezcla en OKLab con --card', () => {
    const tintes: [string, string, number][] = [
      ['--org-rfee-tinte', '--org-rfee', 0.14],
      ['--org-fie-tinte', '--org-fie', 0.14],
      ['--org-efc-tinte', '--org-efc', 0.14],
      ['--org-aut-tinte', '--org-aut', 0.14],
      ['--warn-tinte', '--warn', 0.12],
      ['--ok-tinte', '--ok', 0.12],
      ['--danger-tinte', '--danger', 0.12],
      ['--gold-tinte', '--gold', 0.12],
    ];
    for (const [tinte, texto, p] of tintes) {
      expect(razon(color(texto), color(tinte)), `${texto} sobre ${tinte}`).toBeGreaterThanOrEqual(4.5);
      expect(razon(color('--foreground'), color(tinte)), `--foreground sobre ${tinte}`).toBeGreaterThanOrEqual(4.5);
      const esperado = mezclaOklab(color(texto), color('--card'), p);
      const real = color(tinte);
      for (const k of ['r', 'g', 'b'] as const)
        expect(Math.abs(real[k] - esperado[k]), `${tinte} recalculado sobre --card`).toBeLessThanOrEqual(2);
    }
  });
});

describe('contraste 3:1 de lo que es la única señal de un control (WCAG 1.4.11)', () => {
  it('anillo de foco, canto de campo y contorno del marcado sobre cada superficie', () => {
    expect(pares(['--ring', '--borde-campo', '--primary-text'], [...SUPERFICIES, '--marcado'], 3)).toEqual([]);
  });

  it('el relleno de la acción principal se ve como objeto sobre el lienzo y la tarjeta', () => {
    expect(pares(['--primary'], ['--background', '--card'], 3)).toEqual([]);
  });
});

describe('cristal', () => {
  const blanco: Rgba = { r: 255, g: 255, b: 255, a: 1 };

  it('las barras en reposo y su sólido equivalente son el mismo tono', () => {
    const reposo = encima(color('--cristal'), color('--background'));
    const solido = color('--cristal-solido');
    for (const k of ['r', 'g', 'b'] as const) expect(Math.abs(reposo[k] - solido[k])).toBeLessThanOrEqual(1);
  });

  it('el texto de las barras pasa AA sobre el cristal con el lienzo detrás', () => {
    const fondo = encima(color('--cristal'), color('--background'));
    for (const t of ['--foreground', '--muted-foreground', '--off'])
      expect(razon(color(t), fondo), t).toBeGreaterThanOrEqual(4.5);
  });

  it('un panel sobre el velo pasa AA aunque detrás haya una foto blanca', () => {
    const detras = encima(color('--velo'), blanco);
    const panel = encima(color('--cristal-panel'), detras);
    for (const t of ['--foreground', '--muted-foreground', '--off', '--primary-text'])
      expect(razon(color(t), panel), t).toBeGreaterThanOrEqual(4.5);
  });

  it('es un material translúcido de verdad, con canto de luz y alternativa sólida', () => {
    expect(color('--cristal').a).toBeGreaterThan(0.6);
    expect(color('--cristal').a).toBeLessThan(0.9);
    expect(color('--cristal-borde')).toMatchObject({ r: 255, g: 255, b: 255, a: 0.08 });
    expect(tokens.get('--cristal-filtro')).toBe('blur(16px) saturate(1.2)');
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  });
});

describe('lienzo', () => {
  it('html es un color plano, sin capas de imagen', () => {
    const html = /html \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(html).toContain('background-color: var(--background)');
    expect(css).not.toMatch(/background-image:\s*var\(--capa-/);
    expect(css).not.toMatch(/\.fondo-(pantalla|cabecera|panel)\s*\{|\.tinte-(marca|rfee|fie|efc|aut|oro)\s*\{|\.acrilico\s*\{/);
  });
});
