import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TABLAS_DEPORTIVAS_ESPERADAS,
  cargarMigracionesLocales,
  evaluarPreflight,
  type EstadoLeido,
} from '@/lib/db/migracion-aditiva';

const PENDIENTES = ['0017_identidad_deportiva', '0018_referencias_de_inscripcion', '0019_categorias_m10_m12'];
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
  entries: { tag: string; when: number }[];
};
const locales = cargarMigracionesLocales(journal, (tag) => readFileSync(`drizzle/${tag}.sql`, 'utf8'));
const previas = locales.slice(0, -3);

const estadoBase = (): EstadoLeido => ({
  ledger: previas.map((m) => ({ hash: m.hash, created_at: m.when })),
  tablasSport: [],
  tablasPrevias: ['athlete', 'event', 'event_competition', 'user_profile', 'competition_registration'],
  enums: {
    weapon: ['FOIL'],
    gender: ['M', 'F'],
    competition_format: ['INDIVIDUAL'],
    category_code: ['M9', 'M11', 'M13'],
  },
});

describe('preflight de migraciones aditivas 0017→0018→0019', () => {
  it('calcula el hash como Drizzle: sha256 del archivo completo', () => {
    const m = locales.find((l) => l.tag === PENDIENTES[1])!;
    const texto = readFileSync(`drizzle/${PENDIENTES[1]}.sql`, 'utf8').replace(/\r\n/g, '\n');
    expect(m.hash).toBe(createHash('sha256').update(texto).digest('hex'));
    expect(m.sentencias.length).toBe(3);
  });

  it('el hash no depende de que el árbol de trabajo traiga CRLF', () => {
    const lf = readFileSync(`drizzle/${PENDIENTES[1]}.sql`, 'utf8').replace(/\r\n/g, '\n');
    const crlf = cargarMigracionesLocales({ entries: [{ tag: 'x', when: 1 }] }, () => lf.replace(/\n/g, '\r\n'));
    expect(crlf[0].hash).toBe(createHash('sha256').update(lf).digest('hex'));
    expect(crlf[0].sentencias.join('')).not.toContain('\r');
  });

  it('las tres pendientes son la cola del journal y crean las 13 tablas', () => {
    expect(locales.slice(-3).map((m) => m.tag)).toEqual(PENDIENTES);
    const sql = locales.slice(-3).map((m) => m.sentencias.join('\n')).join('\n');
    const creadas = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(sport_[a-z_]+)"/g)].map((r) => r[1]).sort();
    expect(creadas).toEqual([...TABLAS_DEPORTIVAS_ESPERADAS].sort());
    const inicios = locales
      .slice(-3)
      .flatMap((m) => m.sentencias)
      .map((s) => s.replace(/^(--.*\n)+/, '').split(/\s+/).slice(0, 3).join(' '));
    for (const inicio of inicios) {
      expect(inicio).toMatch(/^(DO \$\$ BEGIN|CREATE TABLE IF|CREATE INDEX IF|CREATE UNIQUE INDEX|ALTER TYPE "category_code")/);
    }
  });

  it('acepta el estado esperado y devuelve las pendientes en orden', () => {
    const v = evaluarPreflight(locales, estadoBase(), PENDIENTES);
    expect(v.ok && v.pendientes.map((m) => m.tag)).toEqual(PENDIENTES);
  });

  it('para si un hash del ledger difiere', () => {
    const e = estadoBase();
    e.ledger[3] = { ...e.ledger[3], hash: 'x' };
    const v = evaluarPreflight(locales, e, PENDIENTES);
    expect(v.ok).toBe(false);
  });

  it('para si el ledger tiene filas de más, de menos o una pendiente ya registrada', () => {
    const menos = estadoBase();
    menos.ledger.pop();
    expect(evaluarPreflight(locales, menos, PENDIENTES).ok).toBe(false);

    const mas = estadoBase();
    mas.ledger.push({ hash: locales.at(-3)!.hash, created_at: locales.at(-3)!.when });
    expect(evaluarPreflight(locales, mas, PENDIENTES).ok).toBe(false);
  });

  it('para si ya hay tablas sport, enums deportivos, M10/M12 o falta una tabla previa', () => {
    const t = estadoBase();
    t.tablasSport = ['sport_person'];
    const e = estadoBase();
    e.enums.sport_link_status = ['PROPUESTO'];
    const m = estadoBase();
    m.enums.category_code.push('M10');
    const f = estadoBase();
    f.tablasPrevias = f.tablasPrevias.filter((x) => x !== 'event');
    for (const estado of [t, e, m, f]) expect(evaluarPreflight(locales, estado, PENDIENTES).ok).toBe(false);
  });

  it('para si las pendientes declaradas no son la cola del journal', () => {
    expect(evaluarPreflight(locales, estadoBase(), [PENDIENTES[0], PENDIENTES[2]]).ok).toBe(false);
  });
});
