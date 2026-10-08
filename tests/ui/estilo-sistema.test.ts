import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Trinquete del sistema visual (`docs/diseno-sistema.md` § 2 y § 3).
 *
 * Cuenta, por fichero, los usos que el sistema ya no admite y los compara con
 * `tests/ui/estilo-sistema.base.json`. Ningún fichero puede tener más que en
 * la base y un fichero que no está en la base no puede tener ninguno. Bajar
 * es libre; para fijar la base nueva tras bajar:
 *
 *   ACTUALIZAR_BASE=1 npx vitest run tests/ui/estilo-sistema.test.ts
 */

type Regla = { id: string; descripcion: string; contar: (fuente: string, ruta: string) => number };

const RAIZ = process.cwd();
const RUTA_BASE = join(RAIZ, 'tests/ui/estilo-sistema.base.json');

/** Tablas y visores de datos donde el desplazamiento horizontal es el formato. */
export const DESPLAZAMIENTO_PERMITIDO = new Set([
  'src/components/ui/table.tsx',
  'src/components/admin/cuarentena-panel.tsx',
]);

const contar = (fuente: string, patron: RegExp) => [...fuente.matchAll(patron)].length;

const FAMILIAS_ESPACIO = '(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy])';

export const REGLAS: Regla[] = [
  {
    id: 'desplazamiento-horizontal',
    descripcion: 'carril con desplazamiento horizontal fuera de una tabla o visor de datos',
    contar: (f, ruta) => {
      if (DESPLAZAMIENTO_PERMITIDO.has(ruta)) return 0;
      const directo = contar(f, /(?<![\w-])overflow-x-(?:auto|scroll)\b|(?<![\w-])snap-x\b|overflow-x:\s*(?:auto|scroll)/g);
      // Un carril sin `overflow-x-*`: `overflow-auto` + `whitespace-nowrap` en la misma lista de clases.
      const carril = contar(
        f,
        /(?<![\w-])overflow-auto\b[^'"`\n]*(?<![\w-])whitespace-nowrap\b|(?<![\w-])whitespace-nowrap\b[^'"`\n]*(?<![\w-])overflow-auto\b/g,
      );
      return directo + carril;
    },
  },
  {
    id: 'tamano-texto-arbitrario',
    descripcion: 'tamaño de letra arbitrario (`text-[13px]`); usar text-xs/sm/base/lg/xl/2xl',
    contar: (f) => contar(f, /(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem)\]/g),
  },
  {
    id: 'espaciado-fuera-de-escala',
    descripcion: 'espaciado que no es múltiplo de 4 px (`py-[6px]`) o medio paso (`py-1.5`)',
    contar: (f) => {
      let n = 0;
      const patron = new RegExp(`(?<![\\w-])-?${FAMILIAS_ESPACIO}-(?:(0\\.5|1\\.5|2\\.5|3\\.5)(?![\\w.])|\\[(-?\\d+(?:\\.\\d+)?)px\\])`, 'g');
      for (const m of f.matchAll(patron)) {
        if (m[1]) n += 1;
        else if (Number(m[2]) % 4 !== 0) n += 1;
      }
      return n;
    },
  },
  {
    id: 'alfa-en-texto',
    descripcion: 'alfa sobre un token de texto (`text-muted-foreground/70`); usar --muted-foreground u --off',
    contar: (f) => contar(f, /(?<![\w-])text-(?:muted-foreground|off|foreground)\/(?:\d+|\[[^\]]+\])/g),
  },
  {
    id: 'brillos-y-manchas',
    descripcion: 'degradado radial o cónico, grano SVG o sombra de color sin desplazamiento (brillo)',
    contar: (f) =>
      contar(f, /radial-gradient|conic-gradient|feTurbulence/g) +
      // Sombra centrada con desenfoque: `shadow-[0_0_24px_…]` o `box-shadow: 0 0 24px …`.
      contar(f, /(?<![\d._])0_0_[1-9]\d*(?:\.\d+)?px|box-shadow:\s*0\s+0\s+[1-9]/g) +
      contar(f, /(?<![\w-])(?:drop-)?shadow-(?:primary|gold|ok|warn|danger|destructive|org-[a-z]+|marcado|ring)\b/g) +
      // Manchas desenfocadas de decoración.
      contar(f, /(?<![\w-])blur-(?:2xl|3xl|\[\d{2,}px\])/g),
  },
];

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta, salida);
    else if (/\.(?:ts|tsx|css)$/.test(nombre) && !nombre.endsWith('.d.ts')) salida.push(ruta);
  }
  return salida;
}

/** Sin comentarios: la documentación puede nombrar lo que la regla prohíbe. */
function limpiar(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export type Recuento = Record<string, Record<string, number>>;

export function medir(): Recuento {
  const recuento: Recuento = Object.fromEntries(REGLAS.map((r) => [r.id, {}]));
  for (const absoluta of recorrer(join(RAIZ, 'src')).sort()) {
    const ruta = relative(RAIZ, absoluta).split(sep).join('/');
    const fuente = limpiar(readFileSync(absoluta, 'utf8'));
    for (const regla of REGLAS) {
      const n = regla.contar(fuente, ruta);
      if (n > 0) recuento[regla.id][ruta] = n;
    }
  }
  return recuento;
}

const actual = medir();

if (process.env.ACTUALIZAR_BASE === '1') {
  writeFileSync(RUTA_BASE, `${JSON.stringify(actual, null, 2)}\n`);
}

const base: Recuento = existsSync(RUTA_BASE) ? JSON.parse(readFileSync(RUTA_BASE, 'utf8')) : {};

describe('estilo del sistema: trinquete por fichero', () => {
  for (const regla of REGLAS) {
    it(`${regla.id}: ${regla.descripcion}`, () => {
      const permitido = base[regla.id] ?? {};
      const crecen = Object.entries(actual[regla.id])
        .filter(([ruta, n]) => n > (permitido[ruta] ?? 0))
        .map(([ruta, n]) => `${ruta}: ${n} (base ${permitido[ruta] ?? 0})`);
      expect(crecen, `Suben respecto a ${relative(RAIZ, RUTA_BASE)}`).toEqual([]);
    });
  }

  it('la base existe y cubre todas las reglas', () => {
    expect(existsSync(RUTA_BASE)).toBe(true);
    for (const regla of REGLAS) expect(base[regla.id], regla.id).toBeDefined();
  });

  it('las reglas cazan lo que dicen', () => {
    const muestra = [
      '"flex overflow-x-auto snap-x"',
      '"overflow-auto whitespace-nowrap"',
      '"text-[13px] text-[0.6875rem] text-sm"',
      '"py-1.5 gap-0.5 -mt-[6px] px-[8px] p-[2px] py-2 top-1.5 h-2.5"',
      '"text-muted-foreground/70 text-foreground/[0.6] text-muted-foreground"',
      'radial-gradient(circle) "shadow-[0_0_24px_red] shadow-[0_0_0_1.5px_var(--x)] shadow-primary/30 blur-3xl backdrop-blur-[20px]"',
    ].join('\n');
    const n = Object.fromEntries(REGLAS.map((r) => [r.id, r.contar(muestra, 'src/x.tsx')]));
    expect(n).toEqual({
      'desplazamiento-horizontal': 3,
      'tamano-texto-arbitrario': 2,
      'espaciado-fuera-de-escala': 4,
      'alfa-en-texto': 2,
      'brillos-y-manchas': 4,
    });
    expect(REGLAS[0].contar('"overflow-x-auto"', 'src/components/ui/table.tsx')).toBe(0);
  });
});
