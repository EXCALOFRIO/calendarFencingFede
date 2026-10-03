import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { cronExecution } from '@/db/schema/cron';
import { cargarMigracionesLocales } from '@/lib/db/migracion-aditiva';
import {
  MIGRACION_CRON,
  evaluarPreflightCron,
  type EstadoMigracionCron,
} from '@/lib/cron/migracion';

const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const hasta0020 = journal.entries.findIndex((e: { tag: string }) => e.tag === MIGRACION_CRON);
const locales = cargarMigracionesLocales({ entries: journal.entries.slice(0, hasta0020 + 1) },
  (tag) => readFileSync(`drizzle/${tag}.sql`, 'utf8'));
const estadoBase = (): EstadoMigracionCron => ({
  ledger: locales.slice(0, -1).map((m) => ({ hash: m.hash, created_at: m.when })),
  tablaCronExiste: false,
  tablaIngestExiste: true,
});

describe('migración acotada 0020 de crons', () => {
  it('añade sólo una tabla con clave primaria tarea/minuto, sin alterar previas', () => {
    const m = locales.at(-1)!;
    expect(m.tag).toBe(MIGRACION_CRON);
    expect(journal.entries[hasta0020].idx).toBe(20);
    expect(m.when).toBeGreaterThan(locales.at(-2)!.when);
    expect(m.sentencias).toHaveLength(1);
    const sentencia = m.sentencias[0].replace(/^--.*\n/gm, '');
    expect(sentencia.trim()).toMatch(/^CREATE TABLE "public"\."cron_execution"/);
    expect(sentencia).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|TRUNCATE|IF NOT EXISTS)\b/);
    const t = getTableConfig(cronExecution);
    expect(t.name).toBe('cron_execution');
    expect(t.primaryKeys).toHaveLength(1);
    expect(t.primaryKeys[0].columns.map((c) => c.name)).toEqual(['task', 'scheduled_minute']);
    expect(t.primaryKeys[0].getName()).toBe('cron_execution_task_minute_pk');
    for (const c of t.columns) expect(sentencia).toContain(`"${c.name}"`);
    for (const c of t.checks) expect(sentencia).toContain(`CONSTRAINT "${c.name}"`);
    expect(sentencia).toContain('PRIMARY KEY ("task", "scheduled_minute")');
  });

  it('acepta sólo ledger completo 0000→0019, sin escribir ni aplicar previas', () => {
    const v = evaluarPreflightCron(locales, estadoBase());
    expect(v.ok && v.pendiente.tag).toBe(MIGRACION_CRON);
  });

  it.each(['hash', 'created_at', 'menos', 'mas', 'previa_pendiente', 'tabla', 'ingest', 'ya_aplicada'])(
    'rechaza el estado inseguro %s',
    (caso) => {
      const e = estadoBase();
      if (caso === 'hash') e.ledger[0].hash = 'distinto';
      if (caso === 'created_at') e.ledger[0].created_at++;
      if (caso === 'menos' || caso === 'previa_pendiente') e.ledger.pop();
      if (caso === 'mas') e.ledger.push({ hash: 'extra', created_at: 9_999_999_999_999 });
      if (caso === 'tabla') e.tablaCronExiste = true;
      if (caso === 'ingest') e.tablaIngestExiste = false;
      if (caso === 'ya_aplicada') {
        const m = locales.at(-1)!;
        e.ledger.push({ hash: m.hash, created_at: m.when });
      }
      expect(evaluarPreflightCron(locales, e).ok).toBe(false);
    },
  );

  it('rechaza journal sin 0020, otra cola, duplicado o reloj no creciente', () => {
    expect(evaluarPreflightCron([], estadoBase()).ok).toBe(false);
    expect(evaluarPreflightCron(locales.slice(0, -1), estadoBase()).ok).toBe(false);
    expect(evaluarPreflightCron([...locales, { ...locales.at(-1)!, tag: '0021_otra' }], estadoBase()).ok).toBe(false);
    expect(evaluarPreflightCron([...locales, locales.at(-1)!], estadoBase()).ok).toBe(false);
    const noCreciente = locales.map((m) => ({ ...m }));
    noCreciente.at(-1)!.when = noCreciente.at(-2)!.when;
    expect(evaluarPreflightCron(noCreciente, estadoBase()).ok).toBe(false);
  });

  it('el script acota la transacción y vuelve a comprobar el ledger bajo bloqueo', () => {
    const script = readFileSync('scripts/aplicar-migracion-crons.ts', 'utf8');
    expect(script).toContain("const LOCK_TIMEOUT = '10s'");
    expect(script).toContain("const STATEMENT_TIMEOUT = '120s'");
    expect(script).toContain('readOnly: true');
    expect(script).toContain('lock table ${LEDGER} in exclusive mode');
    expect(script).toContain('preflight_seguro');
    expect(script).toContain('...m.sentencias.map');
    expect(script).toContain('[m.hash, m.when]');
    expect(script).toContain('journal.entries.slice(0, hasta0020 + 1)');
    expect(script).not.toContain('drizzle-kit');
    expect(script).not.toContain('console.error(error');
  });
});
