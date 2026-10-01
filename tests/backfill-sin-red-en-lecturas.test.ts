import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Las consultas de lectura (calendario, perfiles, búsqueda) leen la base y nunca
 * llegan a un proveedor. Sólo el comando de backfill y los jobs acotados pueden
 * importar los lectores de red; esta guarda falla si una consulta o una pantalla
 * empieza a depender de ellos.
 */
const RAIZ = path.resolve(__dirname, '..', 'src');
const PROHIBIDO = /from\s+['"](?:@\/lib\/|(?:\.\.?\/)+)ingest\/(?:backfill|fetcher|historico-red|runner)[^'"]*['"]/;

function ficheros(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return ficheros(ruta);
    return /\.(ts|tsx)$/.test(e.name) ? [ruta] : [];
  });
}

describe('las lecturas no disparan red (VAL-BACKFILL-007)', () => {
  const dirs = ['lib/queries', 'lib/sport'].map((d) => path.join(RAIZ, d));

  it('consultas y utilidades deportivas no importan el backfill, el fetcher ni el runner de ingesta', () => {
    const infractores = dirs
      .flatMap(ficheros)
      .filter((f) => PROHIBIDO.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(RAIZ, f));
    expect(infractores).toEqual([]);
  });

  it('las pantallas (app y componentes) no importan el backfill ni el fetcher de red', () => {
    const infractores = ['app', 'components']
      .flatMap((d) => ficheros(path.join(RAIZ, d)))
      // Las rutas de cron/admin sí lanzan ingesta por diseño; la guarda es para pantallas.
      .filter((f) => !/[\\/]api[\\/]/.test(f) && !f.endsWith('consultas.ts'))
      .filter((f) => PROHIBIDO.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(RAIZ, f));
    expect(infractores).toEqual([]);
  });

  it('el comando de simulación nunca construye el ejecutor de red', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'backfill.ts'), 'utf8');
    // Los clientes de red sólo se importan dentro de crearEjecutor, que el CLI invoca únicamente con --aplicar.
    const fuera = script.slice(0, script.indexOf('async function crearEjecutor'));
    expect(fuera).not.toMatch(/fetcher|historico-red|sources\//);
  });
});
