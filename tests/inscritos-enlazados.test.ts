import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import { personaDeFila, unirObservaciones, type FilaUnida, type InscritoPublicado, type Observacion } from '@/lib/entries/union';

vi.mock('@/lib/auth/session', () => ({ getManagedAthletes: async () => [] }));

const { crearCachesCalendario, aListaPublica, paresDeLista } = await import('@/lib/queries/calendario-cache-modelo');
const { construirExtras, elegirPuestos } = await import('@/lib/queries/inscritos-extras');
const { quienVaDelEvento } = await import('@/lib/queries/quien-va');
const { FilaInscrito } = await import('@/components/calendario/fila-inscrito');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const obs = (o: Partial<Observacion>): Observacion => ({
  competitionId: 'c1', nombre: 'PEREZ GARCIA Ana', equipo: '', club: 'CLUB X', athleteId: null,
  retiradoEn: null, fuente: 'fie', sourceUrl: null, leidoEl: null, ...o,
});

describe('a quién enlaza cada inscrito', () => {
  it('enlaza sólo con una persona confirmada por ID, nunca por nombre', () => {
    const [confirmada] = unirObservaciones([obs({ resolucion: { kind: 'confirmed', personId: P1 } })]);
    expect(personaDeFila(confirmada)).toBe(P1);

    const [porNombre] = unirObservaciones([obs({ resolucion: { kind: 'review', personIds: [P1] } })]);
    expect(personaDeFila(porNombre)).toBeNull();

    const [sinNada] = unirObservaciones([obs({})]);
    expect(personaDeFila(sinNada)).toBeNull();
  });

  it('en la duda no enlaza: conflicto o dos fichas; un miembro de equipo confirmado, sí', () => {
    const [conflicto] = unirObservaciones([obs({ resolucion: { kind: 'conflict', personIds: [P1, P2] } })]);
    expect(personaDeFila(conflicto)).toBeNull();

    const dosFichas: Pick<FilaUnida, 'observaciones'> = {
      observaciones: [
        obs({ athleteId: 'a1', resolucion: { kind: 'confirmed', personId: P1 } }),
        obs({ athleteId: 'a2', fuente: 'skermo_rfee', resolucion: { kind: 'confirmed', personId: P1 } }),
      ],
    };
    expect(personaDeFila(dosFichas)).toBeNull();

    const [equipo] = unirObservaciones([obs({ equipo: 'Spain', resolucion: { kind: 'confirmed', personId: P1 } })]);
    expect(personaDeFila(equipo)).toBe(P1);
  });

  it('la lista pública lleva la persona y no las evidencias', () => {
    const lista = aListaPublica({
      filas: unirObservaciones([obs({ resolucion: { kind: 'confirmed', personId: P1 }, sourceUrl: 'https://fie.test/x' })]),
      estados: { c1: 'con_datos' },
    });
    expect(lista.filas[0].personaId).toBe(P1);
    expect(JSON.stringify(lista)).not.toMatch(/fie\.test|observaciones|resolucion/);
    expect(paresDeLista(lista)).toEqual([{ competitionId: 'c1', personaId: P1 }]);
  });
});

describe('puestos FIE y RFEE de los inscritos', () => {
  const fila = (o: Partial<{ c: string; p: string; cat: string; categoria: string; puesto: number; ref: string }>) => ({
    c: 'c1', p: P1, cat: 'M20', categoria: 'M20', puesto: 7, ref: 'r1', ...o,
  });

  it('prefiere la categoría de la prueba y, si no figura, el absoluto', () => {
    const conAmbos = elegirPuestos([fila({ categoria: 'ABS', puesto: 40, ref: 'r2' }), fila({})]);
    expect(conAmbos.get(`c1|${P1}`)).toEqual({ puesto: 7, absoluto: false });
    const soloAbs = elegirPuestos([fila({ categoria: 'ABS', puesto: 40 })]);
    expect(soloAbs.get(`c1|${P1}`)).toEqual({ puesto: 40, absoluto: true });
  });

  it('dos filas distintas en la misma lista no eligen ninguna', () => {
    const ambiguo = elegirPuestos([fila({ ref: 'r1', puesto: 7 }), fila({ ref: 'r9', puesto: 90 })]);
    expect(ambiguo.has(`c1|${P1}`)).toBe(false);
  });

  it('construye un extra por par, con país válido o ninguno', () => {
    const extras = construirExtras(
      [{ competitionId: 'c1', personaId: P1 }, { competitionId: 'c1', personaId: P2 }],
      [fila({})],
      [fila({ categoria: 'ABS', puesto: 3 })],
      [{ p: P1, pais: 'ESP' }, { p: P2, pais: 'es' }],
    );
    expect(extras[`c1|${P1}`]).toEqual({ pais: 'ESP', mundial: { puesto: 7, absoluto: false }, nacional: { puesto: 3, absoluto: true } });
    expect(extras[`c1|${P2}`]).toEqual({ pais: null, mundial: null, nacional: null });
  });
});

describe('caché: lista y extras por separado, sin datos de cuenta', () => {
  function entorno(fallanExtras = false) {
    const memoria = almacenMemoria();
    const cache = crearCache({
      almacen: () => memoria,
      versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 1, calendario: 3, deporte: 2 }, deps), olvidar() {} },
      esperar: () => {},
    });
    const cuentas = { inscritos: 0, extras: 0 };
    const caches = crearCachesCalendario({
      cache,
      leer: {
        eventos: async () => [],
        tramo: async () => { throw new Error('no'); },
        detalle: async () => null,
        inscritos: async () => {
          cuentas.inscritos++;
          return {
            filas: unirObservaciones([
              obs({ nombre: 'UNO', athleteId: 'ath-1', resolucion: { kind: 'confirmed', personId: P1 } }),
              obs({ nombre: 'DOS' }),
            ]),
            estados: { c1: 'con_datos' },
          };
        },
        podios: async () => ({ tipo: 'ok', ediciones: [], podios: {} }),
        extrasInscritos: async (pares) => {
          cuentas.extras++;
          if (fallanExtras) throw new Error('D1');
          return Object.fromEntries(pares.map((x) => [`${x.competitionId}|${x.personaId}`, { pais: 'ESP', mundial: { puesto: 12, absoluto: false }, nacional: null }]));
        },
        hoy: () => '2026-10-08',
      },
    });
    return { caches, cuentas };
  }

  it('los extras se cuelgan de su fila y se guardan una vez para todas las cuentas', async () => {
    const { caches, cuentas } = entorno();
    const l = await caches.listaPublica('e1');
    await caches.listaPublica('e1');
    expect(cuentas).toEqual({ inscritos: 1, extras: 1 });
    const uno = l.filas.find((f) => f.nombre === 'UNO')!;
    const dos = l.filas.find((f) => f.nombre === 'DOS')!;
    expect(uno.personaId).toBe(P1);
    expect(uno.extra).toEqual({ pais: 'ESP', mundial: { puesto: 12, absoluto: false }, nacional: null });
    expect(dos.personaId).toBeNull();
    expect(dos.extra).toBeUndefined();
    expect(buscarDatoDeCuenta(l)).toBeNull();

    const vista = await quienVaDelEvento({ profileId: 'a', role: 'athlete' }, 'e1', caches.listaPublica('e1'));
    expect(vista.oficiales.find((o) => o.nombre === 'UNO')).toMatchObject({ personaId: P1, extra: { pais: 'ESP' } });
    expect(JSON.stringify(vista)).not.toContain('ath-1');
  });

  it('si fallan los extras, la lista sale igual y con sus enlaces', async () => {
    const { caches } = entorno(true);
    const l = await caches.listaPublica('e1');
    expect(l.filas.find((f) => f.nombre === 'UNO')).toMatchObject({ personaId: P1 });
    expect(l.filas.every((f) => !f.extra)).toBe(true);
  });
});

describe('fila de inscrito', () => {
  const base: InscritoPublicado = {
    competitionId: 'c1', nombre: 'PEREZ GARCIA Ana', equipo: null, club: 'CLUB NACIONAL X', esMio: false, retiradoEn: null,
  };
  const html = (i: InscritoPublicado) => renderToStaticMarkup(React.createElement(FilaInscrito, { inscrito: i }));

  it('enlazada: perfil, nombre visible, bandera y puestos; nunca el club', () => {
    const m = html({
      ...base, personaId: P1,
      extra: { pais: 'ESP', mundial: { puesto: 23, absoluto: false }, nacional: { puesto: 4, absoluto: true } },
    });
    expect(m).toContain(`href="/explorar/${P1}"`);
    expect(m).toContain('Ana Perez Garcia');
    expect(m).toMatch(/FIE <span[^>]*>23<\/span>/);
    expect(m).toMatch(/RFEE <span[^>]*>4<\/span>/);
    expect(m).toContain(' abs');
    expect(m).toContain('min-h-[44px]');
    expect(m).not.toContain('CLUB');
    expect(m).not.toMatch(/text-\[(1[01]|[0-9])px\]/);
  });

  it('sin persona demostrada: sin enlace ni retrato pedido, con iniciales', () => {
    const m = html(base);
    expect(m).not.toContain('href=');
    expect(m).toContain('AP');
    expect(m).not.toContain('FIE');
    expect(m).not.toContain('CLUB');
  });
});
