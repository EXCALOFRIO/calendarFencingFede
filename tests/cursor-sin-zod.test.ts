import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codificarCursor, decodificarCursor, FECHA_RE, UUID_RE } from '@/lib/sport/explorar/cursor';
import * as patrones from '@/lib/sport/explorar/patrones';

const raiz = path.resolve(import.meta.dirname, '..');
const src = path.join(raiz, 'src');
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('cursor sin zod', () => {
  it('ida y vuelta, y rechaza formas inválidas como antes', () => {
    const filtros = { cuenta: 'x', soloMedallas: false };
    const c = codificarCursor('siguiendo', filtros, ['2026-01-01', 'abc', 3]);
    expect(decodificarCursor('siguiendo', filtros, c, 3)).toEqual(['2026-01-01', 'abc', 3]);
    expect(decodificarCursor('siguiendo', filtros, c, 2)).toBeNull();
    expect(decodificarCursor('siguiendo', { ...filtros, soloMedallas: true }, c, 3)).toBeNull();
    expect(decodificarCursor('otra', filtros, c, 3)).toBeNull();

    const h = JSON.parse(Buffer.from(c, 'base64url').toString()).h as string;
    const valido = { v: 1, h, k: ['a'] };
    expect(decodificarCursor('siguiendo', filtros, b64(valido), 1)).toEqual(['a']);
    for (const malo of [
      { ...valido, v: 2 }, { ...valido, h: 'x'.repeat(33) }, { ...valido, h: 1 },
      { ...valido, k: ['a', 'b', 'c', 'd', 'e'] }, { ...valido, k: ['x'.repeat(301)] }, { ...valido, k: [true] },
      { ...valido, k: [null] }, { ...valido, k: { 0: 'a' } }, [valido], null, 'texto',
    ]) {
      expect(decodificarCursor('siguiendo', filtros, b64(malo), 1)).toBeNull();
    }
    expect(decodificarCursor('siguiendo', filtros, '%%%', 1)).toBeNull();
    expect(decodificarCursor('siguiendo', filtros, b64('{'), 1)).toBeNull();
  });

  it('las constantes son las mismas desde cursor y desde patrones', () => {
    expect(UUID_RE).toBe(patrones.UUID_RE);
    expect(FECHA_RE).toBe(patrones.FECHA_RE);
    expect(UUID_RE.test('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(FECHA_RE.test('2026-10-08')).toBe(true);
  });

  /**
   * Comprobación estática (sin build): desde cada fichero `'use client'` se
   * siguen los imports de valor (no `import type`) y se para en los módulos
   * `'use server'` o `server-only`, que no viajan al navegador. Ninguno debe
   * llegar a zod. `tests/perf/sin-zod-cliente.mts` lo comprueba sobre los chunks.
   */
  it('ningún módulo alcanzable desde un componente de cliente importa zod', () => {
    const ficheros: string[] = [];
    const recorrer = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (/\.(tsx?|mts)$/.test(e.name)) ficheros.push(p);
      }
    };
    recorrer(src);
    const textos = new Map<string, string>();
    const leer = (f: string) => textos.get(f) ?? textos.set(f, readFileSync(f, 'utf8')).get(f)!;
    const resolver = (desde: string, spec: string): string | null => {
      const base = spec.startsWith('@/') ? path.join(src, spec.slice(2))
        : spec.startsWith('.') ? path.resolve(path.dirname(desde), spec) : null;
      if (!base) return null;
      for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
        if (existsSync(c) && statSync(c).isFile()) return c;
      }
      return null;
    };
    const servidor = (t: string) => /^\s*['"]use server['"]/.test(t) || /import\s+['"]server-only['"]/.test(t);
    const clientes = ficheros.filter((f) => /^\s*['"]use client['"]/.test(leer(f)));
    expect(clientes.length).toBeGreaterThan(10);
    const padre = new Map<string, string | null>(clientes.map((c) => [c, null]));
    const cola = [...clientes];
    const conZod: string[] = [];
    while (cola.length) {
      const f = cola.shift()!;
      const texto = leer(f);
      const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
      for (const m of texto.matchAll(re)) {
        if (m[1]) continue;
        const spec = m[2] ?? m[3];
        if (spec === 'zod' || spec.startsWith('zod/')) { conZod.push(f); continue; }
        const r = resolver(f, spec);
        if (r && !padre.has(r) && !servidor(leer(r))) { padre.set(r, f); cola.push(r); }
      }
    }
    const cadenas = [...new Set(conZod)].map((z) => {
      const cadena: string[] = [];
      for (let c: string | null | undefined = z; c; c = padre.get(c)) cadena.push(path.relative(raiz, c));
      return cadena.join(' <- ');
    });
    expect(cadenas).toEqual([]);
  });
});
