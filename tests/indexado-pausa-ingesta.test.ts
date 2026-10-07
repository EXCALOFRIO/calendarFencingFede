import { afterEach, describe, expect, it } from 'vitest';
import { reclamarSportLease } from '@/lib/ingest/sport-incremental/lease';
import {
  horasValidas, sqlLiberar, sqlProrrogar, sqlReservar, vigente, type Lease,
} from '../scripts/indexado/pausa-ingesta';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const PAUSA = '33333333-3333-4333-8333-333333333333';
const OTRO = '44444444-4444-4444-8444-444444444444';
const CRON = '55555555-5555-4555-8555-555555555555';
const abiertos: ReturnType<typeof fixtureDeportivaD1>[] = [];
afterEach(() => { abiertos.splice(0).forEach((l) => l.close()); });

function fixture() {
  const local = fixtureDeportivaD1();
  abiertos.push(local);
  return local;
}

/** Ejecuta las sentencias como `wrangler d1 execute --command` y devuelve la fila del SELECT final. */
function ejecutar(local: ReturnType<typeof fixture>, texto: string): Lease {
  const sentencias = texto.split(';\n');
  for (const s of sentencias.slice(0, -1)) local.sqlite.exec(s);
  return local.sqlite.prepare(sentencias[sentencias.length - 1]).get() as unknown as Lease;
}

describe('pausa de la ingesta automática con el lease global', () => {
  it('mientras la pausa tiene el lease, el cron no puede reclamarlo', async () => {
    const local = fixture();
    const l = ejecutar(local, sqlReservar(PAUSA, 3_600_000));
    expect(l.owner).toBe(PAUSA);
    expect(vigente(l)).toBe(true);
    expect(await reclamarSportLease(local.db, CRON)).toBeNull();
  });

  it('no roba un lease vigente de otro escritor', async () => {
    const local = fixture();
    expect(await reclamarSportLease(local.db, CRON)).not.toBeNull();
    const l = ejecutar(local, sqlReservar(PAUSA, 3_600_000));
    expect(l.owner).toBe(CRON);
  });

  it('prorroga y libera sólo el lease propio; después el cron vuelve a poder escribir', async () => {
    const local = fixture();
    const reservado = ejecutar(local, sqlReservar(PAUSA, 60_000));
    const prorrogado = ejecutar(local, sqlProrrogar(PAUSA, 7_200_000));
    expect(prorrogado.expires_at).toBeGreaterThan(reservado.expires_at);
    expect(ejecutar(local, sqlProrrogar(OTRO, 7_200_000)).owner).toBe(PAUSA);
    expect(vigente(ejecutar(local, sqlLiberar(OTRO)))).toBe(true);
    expect(vigente(ejecutar(local, sqlLiberar(PAUSA)))).toBe(false);
    expect((await reclamarSportLease(local.db, CRON))?.owner).toBe(CRON);
  });

  it('valida owner y horas', () => {
    expect(() => sqlReservar("x' OR 1=1 --", 1000)).toThrow('owner_invalido');
    expect(() => sqlReservar(PAUSA, 0)).toThrow('duracion_invalida');
    expect(horasValidas('6')).toBe(6);
    expect(() => horasValidas('0')).toThrow();
    expect(() => horasValidas('13')).toThrow();
    expect(() => horasValidas('abc')).toThrow();
  });
});
