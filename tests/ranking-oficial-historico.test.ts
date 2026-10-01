import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import {
  diaDeObservacion,
  finDeTemporada,
  huellaDeEntrada,
  mismaLista,
  persistirLecturaRanking,
  type DepsPersistenciaRanking,
  type FilaCoberturaRanking,
  type FilaEntradaRanking,
} from '@/lib/ingest/ranking-oficial-persist';
import {
  claveRanking,
  leerRankingFie,
  leerRankingRfee,
  tareasRankingFie,
  type LecturaRanking,
  type PublicacionRanking,
} from '@/lib/ingest/sources/ranking-oficial-historico';
import { elegirPublicacion, type PublicacionRankingResumen } from '@/lib/sport/ranking-oficial';

const fixture = (nombre: string) =>
  gunzipSync(readFileSync(fileURLToPath(new URL(`./fixtures/historico/${nombre}`, import.meta.url))));
const html = (nombre: string) => fixture(nombre).toString('utf8');
const json = (nombre: string): { fencers: Record<string, unknown>[] } & Record<string, unknown> =>
  JSON.parse(fixture(nombre).toString('utf8'));

const RFEE_2021 = html('ranking-rfee-2021-2022-espada-m-abs.html.gz');
const RFEE_2026 = html('ranking-rfee-2026-2027-espada-m-abs.html.gz');
const COMBO_ABS = { weapon: 'ESPADA', gender: 'M', categoryValue: '7', categoryRaw: 'ABS' } as const;
const HOY = '2026-05-01';

const rfee = (season: { value: string; label: string }, cuerpo: string, combo: typeof COMBO_ABS | { weapon: 'ESPADA'; gender: 'M'; categoryValue: string; categoryRaw: string } = COMBO_ABS) =>
  leerRankingRfee({ season, combo, hoy: HOY }, { html: async () => cuerpo });

const T2021 = { value: '12', label: '2021-2022' };
const T2026 = { value: '17', label: '2026-2027' };

describe('ranking oficial RFEE por temporada (muestras reales anonimizadas)', () => {
  it('lee la lista de cada temporada por separado: distinta URL, season y contenido', async () => {
    const a = await rfee(T2021, RFEE_2021);
    const b = await rfee(T2026, RFEE_2026);
    expect(a.publicacion?.season).toBe('2021-2022');
    expect(b.publicacion?.season).toBe('2026-2027');
    expect(a.url).toContain('season=12');
    expect(b.url).toContain('season=17');
    expect(a.publicacion?.entradas[0].sourceRef).toBe('skermo:731');
    expect(b.publicacion?.entradas[0].sourceRef).toBe('skermo:5068');
    expect(a.publicacion?.entradas[0].puntos).not.toBe(b.publicacion?.entradas[0].puntos);
    expect(a.clave).toBe(b.clave);
  });

  it('conserva fuente, arma, género, categoría, modalidad y el día de lectura (no inventa fecha de publicación)', async () => {
    const { publicacion } = await rfee(T2021, RFEE_2021);
    expect(publicacion).toMatchObject({
      fuente: 'skermo_ranking',
      arma: 'ESPADA',
      genero: 'M',
      categoria: 'ABS',
      categoriaOriginal: 'ABS',
      formato: 'INDIVIDUAL',
      publicadoEl: HOY,
      total: 10,
    });
  });

  it('el puesto 9999 es «sin clasificar» (null) y los puntos 0,00 son cero, no ausencia', async () => {
    const { publicacion, cobertura } = await rfee(T2021, RFEE_2021);
    const entradas = publicacion!.entradas;
    expect(entradas.map((e) => e.posicion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null, null]);
    expect(entradas[0].puntos).toBe('7715.66');
    expect(entradas[8].puntos).toBe('0');
    expect(cobertura).toMatchObject({ estado: 'completo', publicado: 10, importado: 10, error: null });
  });

  it('sin puntos publicados queda null, distinto de 0', async () => {
    const sinPuntos = RFEE_2021.replace('7.715,66', '');
    const { publicacion } = await rfee(T2021, sinPuntos);
    const primera = publicacion?.entradas.find((e) => e.sourceRef === 'skermo:731');
    const cero = publicacion?.entradas.find((e) => e.sourceRef === 'skermo:650');
    expect(primera?.puntos ?? null).toBeNull();
    expect(cero?.puntos).toBe('0');
  });

  it('no deja pasar fecha de nacimiento, club ni nada más que lo imprescindible', async () => {
    const conDatos = RFEE_2021.replace(
      /(<td class="hidden-sm hidden-xs" ><\/td>\s*<td class="hidden-sm hidden-xs" ><\/td>)(\s*<td class="text-right">7\.715,66)/,
      '<td class="hidden-sm hidden-xs" >01/02/2009</td><td class="hidden-sm hidden-xs" >CLUB SECRETO</td>$2',
    );
    const { publicacion } = await rfee(T2021, conDatos);
    const texto = JSON.stringify(publicacion);
    expect(texto).not.toContain('2009');
    expect(texto).not.toContain('SECRETO');
    expect(Object.keys(publicacion!.entradas[0]).sort()).toEqual(
      ['nombre', 'pais', 'posicion', 'puntos', 'referencia', 'sourceRef'].sort(),
    );
  });

  it('una lista vacía es «sin resultados», no publicación (las temporadas viejas del formulario salen así)', async () => {
    const l = await rfee(T2021, '<html><body><table class="table"><thead></thead><tbody></tbody></table></body></html>');
    expect(l.publicacion).toBeNull();
    expect(l.cobertura).toMatchObject({ estado: 'sin_resultados', publicado: 0, importado: 0 });
  });

  it('la categoría que el ranking no publica no se aproxima: M13 se conserva y una desconocida es error', async () => {
    const desconocida = await rfee(T2021, RFEE_2021, { ...COMBO_ABS, categoryRaw: 'M25' });
    expect(desconocida.publicacion).toBeNull();
    expect(desconocida.cobertura.estado).toBe('error');
    expect(desconocida.cobertura.error).toContain('M25');
    const m12 = await rfee(T2021, RFEE_2021, { ...COMBO_ABS, categoryRaw: 'M12' });
    expect(m12.publicacion?.categoria).toBe('M12');
    expect(m12.publicacion?.categoriaOriginal).toBe('M12');
  });

  it('un fallo de red queda en error y no se sustituye por otra lectura', async () => {
    const l = await leerRankingRfee(
      { season: T2021, combo: COMBO_ABS, hoy: HOY },
      {
        html: async () => {
          throw new Error('HTTP 500');
        },
      },
    );
    expect(l.publicacion).toBeNull();
    expect(l.cobertura).toMatchObject({ estado: 'error', error: 'HTTP 500' });
  });

  it('un ID de atleta repetido en la lista es conflicto y no publica la lista', async () => {
    const repetida = RFEE_2021.replaceAll('/RFEE/320?', '/RFEE/731?');
    const l = await rfee(T2021, repetida);
    expect(l.cobertura.estado).toBe('conflicto');
    expect(l.excluidas.repetidas).toBe(1);
  });
});

describe('ranking mundial FIE por temporada (muestras reales anonimizadas)', () => {
  const F2024 = json('fie-ranking-2024-sable-f-senior-i.json.gz');
  const F2027 = json('fie-ranking-2027-sable-f-senior-i.json.gz');
  const E2024 = json('fie-ranking-2024-sable-f-senior-e.json.gz');
  const tarea = { season: 2024, weapon: 'S', gender: 'F', category: 'senior', tipo: 'I' } as const;

  it('hay 48 listas por temporada: 24 individuales y 24 de equipos', () => {
    const t = tareasRankingFie(2024);
    expect(t).toHaveLength(48);
    expect(t.filter((x) => x.tipo === 'I')).toHaveLength(24);
    expect(t.filter((x) => x.tipo === 'E')).toHaveLength(24);
  });

  it('dos temporadas dan dos listas distintas con su season; los puntos se guardan tal cual', async () => {
    const a = await leerRankingFie(tarea, HOY, { json: async () => F2024 });
    const b = await leerRankingFie({ ...tarea, season: 2027 }, HOY, { json: async () => F2027 });
    expect(a.publicacion).toMatchObject({ fuente: 'fie_tiradores', season: '2024', arma: 'SABLE', genero: 'F', formato: 'INDIVIDUAL', total: 10 });
    expect(b.publicacion?.season).toBe('2027');
    expect(a.publicacion?.entradas[0]).toMatchObject({ sourceRef: 'fie:29003', posicion: 1, puntos: '236.000', pais: 'FRA', referencia: { tipo: 'fie', fieId: 29003 } });
    expect(b.publicacion?.entradas[0].sourceRef).toBe('fie:25208');
    expect(a.clave).toBe(claveRanking('SABLE', 'F', 'senior', 'INDIVIDUAL'));
  });

  it('el empate se conserva con el mismo puesto y no se renumera', async () => {
    const b = await leerRankingFie({ ...tarea, season: 2027 }, HOY, { json: async () => F2027 });
    const [p1, p2] = b.publicacion!.entradas;
    expect(p1.puntos).toBe(p2.puntos);
  });

  it('los equipos son otra modalidad: ID de equipo, sin persona y nombrados por país', async () => {
    const e = await leerRankingFie({ ...tarea, tipo: 'E' }, HOY, { json: async () => E2024 });
    expect(e.publicacion?.formato).toBe('EQUIPOS');
    expect(e.clave).toBe(claveRanking('SABLE', 'F', 'senior', 'EQUIPOS'));
    expect(e.clave).not.toBe(claveRanking('SABLE', 'F', 'senior', 'INDIVIDUAL'));
    expect(e.url).toContain('type=E');
    const primera = e.publicacion!.entradas[0];
    expect(primera).toMatchObject({ sourceRef: 'team:6955', nombre: 'FRANCE', referencia: null });
    expect(e.publicacion!.entradas.every((x) => x.sourceRef.startsWith('team:') && x.referencia === null)).toBe(true);
  });

  it('si la FIE devuelve otra temporada, arma, género o modalidad no se importa nada (conflicto)', async () => {
    for (const cambio of [{ season: 2026 }, { weapon: 'E' }, { gender: 'M' }, { type: 'E' }]) {
      const l = await leerRankingFie(tarea, HOY, { json: async () => ({ ...F2024, ...cambio }) });
      expect(l.publicacion).toBeNull();
      expect(l.cobertura.estado).toBe('conflicto');
    }
  });

  it('una respuesta con otra forma es error, no lista vacía', async () => {
    const l = await leerRankingFie(tarea, HOY, { json: async () => ({ message: 'x' }) });
    expect(l.cobertura.estado).toBe('error');
  });

  it('sin puntos queda null y 0 queda como cero; foto, bandera y desglose no pasan el borde', async () => {
    const fencers = [
      { rank: 1, addrId: 1, name: 'A', country: 'SPAIN', countryCode: 'ESP', points: null, birthDate: '2008-01-01', photo: 'x.jpg' },
      { rank: 2, addrId: 2, name: 'B', country: 'SPAIN', countryCode: 'ESP', points: 0 },
      { rank: 3, addrId: 3, name: 'C', country: 'SPAIN', countryCode: 'ESP', points: '' },
    ];
    const l = await leerRankingFie(tarea, HOY, { json: async () => ({ ...F2024, fencers }) });
    expect(l.publicacion!.entradas.map((e) => e.puntos)).toEqual([null, '0', null]);
    expect(JSON.stringify(l.publicacion)).not.toMatch(/2008|photo|birth/);
  });

  it('filas con ID repetido o sin ID válido impiden publicar la lista', async () => {
    const repetida = { ...F2024, fencers: [...F2024.fencers, F2024.fencers[0]] };
    expect((await leerRankingFie(tarea, HOY, { json: async () => repetida })).cobertura.estado).toBe('conflicto');
    const sinId = { ...F2024, fencers: [...F2024.fencers, { rank: 99, name: 'X' }] };
    const l = await leerRankingFie(tarea, HOY, { json: async () => sinId });
    expect(l.cobertura.estado).toBe('parcial');
    expect(l.excluidas.descuadradas).toBe(1);
  });
});

describe('día de observación y huella', () => {
  it('fin de temporada y día de observación no pasan del cierre de la temporada', () => {
    expect(finDeTemporada('2021-2022')).toBe('2022-08-31');
    expect(finDeTemporada('2024')).toBe('2024-08-31');
    expect(finDeTemporada('Histórico')).toBeNull();
    expect(diaDeObservacion('2021-2022', '2026-05-01')).toBe('2022-08-31');
    expect(diaDeObservacion('2026-2027', '2026-05-01')).toBe('2026-05-01');
  });

  it('la huella trata 0 y null como distintos y ignora el orden y los ceros de formato', () => {
    const base = { sourceRef: 'fie:1', position: 1, sourceName: 'A', countryCode: 'ESP' };
    expect(huellaDeEntrada({ ...base, points: null })).not.toBe(huellaDeEntrada({ ...base, points: '0' }));
    expect(huellaDeEntrada({ ...base, points: '236.000' })).toBe(huellaDeEntrada({ ...base, points: '236' }));
    const x = { ...base, points: '1' };
    const y = { ...base, sourceRef: 'fie:2', points: '2' };
    expect(mismaLista([x, y], [y, x])).toBe(true);
    expect(mismaLista([x], [x, y])).toBe(false);
  });
});

/**
 * Almacén EN MEMORIA que imita el contrato de `ranking-oficial-db.ts`: una
 * simulación de la orquestación (identidad, cobertura, no duplicar), no SQL
 * contra Neon.
 */
function almacen(
  opciones: {
    identidad?: boolean;
    historicas?: boolean;
    externos?: ExternalIdRow[];
    licencias?: Record<string, string>;
  } = {},
) {
  type Guardada = { pub: PublicacionRanking; filas: FilaEntradaRanking[] };
  const publicaciones: Guardada[] = [];
  const cobertura = new Map<string, FilaCoberturaRanking>();
  const externos = opciones.externos ?? [];
  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
    personas: async (ids) => new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
  };
  const deps: DepsPersistenciaRanking = {
    esquema: async () => ({ identidad: opciones.identidad ?? true, referencias: true }),
    categoriasHistoricas: async () => opciones.historicas ?? false,
    evidencia,
    licenciasRfee: async (_season, ids) =>
      new Map(ids.flatMap((id) => (opciones.licencias?.[id] ? [[id, opciones.licencias[id]] as const] : []))),
    async escribirPublicacion(pub, filas) {
      const ultima = [...publicaciones]
        .reverse()
        .find(
          (p) =>
            p.pub.fuente === pub.fuente &&
            p.pub.season === pub.season &&
            claveRanking(p.pub.arma, p.pub.genero, p.pub.categoriaOriginal, p.pub.formato) ===
              claveRanking(pub.arma, pub.genero, pub.categoriaOriginal, pub.formato),
        );
      if (ultima && mismaLista(ultima.filas, filas)) {
        let incorporadas = 0;
        ultima.filas.forEach((f, i) => {
          if (f.personId === null && filas[i]?.personId) {
            f.personId = filas[i].personId;
            incorporadas += 1;
          }
        });
        return { estado: 'sin_cambios', publicationId: 'pub', personasIncorporadas: incorporadas };
      }
      publicaciones.push({ pub, filas });
      return { estado: 'creada', publicationId: `pub-${publicaciones.length}`, personasIncorporadas: 0 };
    },
    async upsertCobertura(f) {
      const clave = `${f.source}|${f.season}|${f.competitionKey}`;
      const previa = cobertura.get(clave);
      cobertura.set(clave, {
        ...f,
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
      });
    },
  };
  return { deps, publicaciones, cobertura };
}

const confirmadoFie = (personId: string, value: string): ExternalIdRow => ({
  personId,
  scheme: 'fie_addr_id',
  value,
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
});

const confirmadoRfee = (personId: string, value: string): ExternalIdRow => ({
  personId,
  scheme: 'rfee_license',
  value,
  scopeSource: 'skermo_rfee',
  scopeFederation: 'RFEE',
  scopeSeason: '2021-2022',
  scopeWeapon: '',
  validFrom: '2021-09-01',
  validTo: '2022-08-31',
  linkStatus: 'CONFIRMADO',
});

const fie = (cuerpo: unknown, season = 2024, tipo: 'I' | 'E' = 'I'): Promise<LecturaRanking> =>
  leerRankingFie({ season, weapon: 'S', gender: 'F', category: 'senior', tipo }, HOY, { json: async () => cuerpo });

describe('persistencia del ranking oficial', () => {
  const F2024 = json('fie-ranking-2024-sable-f-senior-i.json.gz');
  const E2024 = json('fie-ranking-2024-sable-f-senior-e.json.gz');

  it('adjunta la persona sólo por ID FIE confirmado; el resto queda pendiente con ID y nombre publicados', async () => {
    const a = almacen({ externos: [confirmadoFie('P1', '29003')] });
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r).toMatchObject({ estado: 'aplicado', publicacion: 'creada', entradas: 10, cobertura: 'completo' });
    expect(r.personas).toMatchObject({ adjuntas: 1, pendientes: 9, conflictos: 0 });
    const filas = a.publicaciones[0].filas;
    expect(filas.find((f) => f.sourceRef === 'fie:29003')?.personId).toBe('P1');
    const pendiente = filas.find((f) => f.sourceRef === 'fie:30542');
    expect(pendiente).toMatchObject({ personId: null, sourceName: 'ATLETA2', position: 2 });
  });

  it('un nombre idéntico al de una persona del censo no adjunta nada sin ID confirmado', async () => {
    const a = almacen({ externos: [confirmadoFie('P-homonima', '99999')] });
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r.personas.adjuntas).toBe(0);
    expect(a.publicaciones[0].filas.every((f) => f.personId === null)).toBe(true);
  });

  it('dos personas confirmadas para el mismo ID FIE es conflicto: no se adjunta a ninguna', async () => {
    const a = almacen({ externos: [confirmadoFie('X', '29003'), confirmadoFie('Y', '29003')] });
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r.personas).toMatchObject({ adjuntas: 0, conflictos: 1 });
    expect(a.publicaciones[0].filas.find((f) => f.sourceRef === 'fie:29003')?.personId).toBeNull();
  });

  it('los equipos nunca llevan persona, aunque su ID coincida con el de una persona confirmada', async () => {
    const a = almacen({ externos: [confirmadoFie('P1', '6955')] });
    const r = await persistirLecturaRanking(a.deps, await fie(E2024, 2024, 'E'));
    expect(r.publicacion).toBe('creada');
    expect(r.personas).toEqual({ adjuntas: 0, pendientes: 0, conflictos: 0, incorporadas: 0 });
    expect(a.publicaciones[0].pub.formato).toBe('EQUIPOS');
    expect(a.publicaciones[0].filas.every((f) => f.personId === null)).toBe(true);
  });

  it('individual y equipos de la misma temporada son publicaciones y coberturas separadas', async () => {
    const a = almacen();
    await persistirLecturaRanking(a.deps, await fie(F2024));
    await persistirLecturaRanking(a.deps, await fie(E2024, 2024, 'E'));
    expect(a.publicaciones.map((p) => p.pub.formato)).toEqual(['INDIVIDUAL', 'EQUIPOS']);
    expect(a.cobertura.size).toBe(2);
  });

  it('RFEE: la licencia publicada para ese ID en esa temporada adjunta la persona confirmada', async () => {
    const a = almacen({ externos: [confirmadoRfee('P7', 'TST00731')], licencias: { '731': 'TST00731' } });
    const r = await persistirLecturaRanking(a.deps, await rfee(T2021, RFEE_2021));
    expect(r.personas).toMatchObject({ adjuntas: 1, pendientes: 9 });
    expect(a.publicaciones[0].filas.find((f) => f.sourceRef === 'skermo:731')?.personId).toBe('P7');
    expect(a.publicaciones[0].filas.find((f) => f.sourceRef === 'skermo:650')).toMatchObject({ position: null, points: '0' });
  });

  it('RFEE: una licencia confirmada en otra temporada no se aplica a esta lista', async () => {
    const otra = { ...confirmadoRfee('P7', 'TST00731'), scopeSeason: '2022-2023', validFrom: '2022-09-01', validTo: '2023-08-31' };
    const a = almacen({ externos: [otra], licencias: { '731': 'TST00731' } });
    const r = await persistirLecturaRanking(a.deps, await rfee(T2021, RFEE_2021));
    expect(r.personas.adjuntas).toBe(0);
  });

  it('repetir la misma lectura no duplica la publicación ni las filas', async () => {
    const a = almacen();
    await persistirLecturaRanking(a.deps, await fie(F2024));
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r.publicacion).toBe('sin_cambios');
    expect(a.publicaciones).toHaveLength(1);
  });

  it('una lista idéntica sólo incorpora a quien se confirmó después', async () => {
    const externos: ExternalIdRow[] = [];
    const a = almacen({ externos });
    await persistirLecturaRanking(a.deps, await fie(F2024));
    externos.push(confirmadoFie('P1', '29003'));
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r.publicacion).toBe('sin_cambios');
    expect(r.personas.incorporadas).toBe(1);
    expect(a.publicaciones).toHaveLength(1);
  });

  it('una lista con puestos o puntos nuevos es otra publicación; la temporada anterior no se toca', async () => {
    const a = await almacen();
    await persistirLecturaRanking(a.deps, await fie(F2024));
    const F2027 = json('fie-ranking-2027-sable-f-senior-i.json.gz');
    await persistirLecturaRanking(a.deps, await fie(F2027, 2027));
    const corregida = { ...F2024, fencers: F2024.fencers.map((f, i) => (i === 0 ? { ...f, points: '237.000' } : f)) };
    await persistirLecturaRanking(a.deps, await fie(corregida));
    expect(a.publicaciones.map((p) => p.pub.season)).toEqual(['2024', '2027', '2024']);
  });

  it('una lectura parcial, en conflicto o con error sólo toca la cobertura y no crea publicación', async () => {
    const a = almacen();
    await persistirLecturaRanking(a.deps, await fie(F2024));
    const antes = [...a.cobertura.values()][0];
    const sinId = { ...F2024, fencers: [...F2024.fencers, { rank: 99, name: 'X' }] };
    const r = await persistirLecturaRanking(a.deps, await fie(sinId));
    expect(r).toMatchObject({ publicacion: null, entradas: 0, cobertura: 'parcial' });
    expect(a.publicaciones).toHaveLength(1);
    const despues = [...a.cobertura.values()][0];
    expect(despues.status).toBe('parcial');
    expect(despues.publishedTotal).toBe(antes.publishedTotal);
    expect(despues.importedTotal).toBe(antes.importedTotal);
  });

  it('sin el esquema deportivo no escribe nada', async () => {
    const a = almacen({ identidad: false });
    const r = await persistirLecturaRanking(a.deps, await fie(F2024));
    expect(r.estado).toBe('esquema_no_aplicado');
    expect(a.publicaciones).toHaveLength(0);
    expect(a.cobertura.size).toBe(0);
  });

  it('M10/M12 sin la migración 0019 quedan pendientes, sin publicación ni aproximación a M13', async () => {
    const l = await rfee(T2021, RFEE_2021, { ...COMBO_ABS, categoryRaw: 'M12' });
    const sin = almacen({ historicas: false });
    const r = await persistirLecturaRanking(sin.deps, l);
    expect(r).toMatchObject({ estado: 'esquema_no_aplicado', cobertura: 'pendiente', publicacion: null });
    expect(sin.publicaciones).toHaveLength(0);
    expect([...sin.cobertura.values()][0]).toMatchObject({ status: 'pendiente' });

    const con = almacen({ historicas: true });
    const r2 = await persistirLecturaRanking(con.deps, l);
    expect(r2.publicacion).toBe('creada');
    expect(con.publicaciones[0].pub).toMatchObject({ categoria: 'M12', categoriaOriginal: 'M12' });
  });
});

describe('selección de la publicación por temporada', () => {
  const p = (id: string, season: string, publishedOn: string, extra: Partial<PublicacionRankingResumen> = {}): PublicacionRankingResumen => ({
    id,
    source: 'skermo_ranking',
    season,
    weapon: 'ESPADA',
    gender: 'M',
    category: 'ABS',
    categoryRaw: 'ABS',
    format: 'INDIVIDUAL',
    publishedOn,
    ...extra,
  });
  const todas = [
    p('a', '2021-2022', '2026-01-10'),
    p('b', '2026-2027', '2026-05-01'),
    p('c', '2021-2022', '2026-02-10'),
    p('d', '2026-2027', '2026-05-01', { format: 'EQUIPOS' }),
  ];
  const filtro = { source: 'skermo_ranking', season: '2021-2022', weapon: 'ESPADA', gender: 'M' };

  it('cambiar de temporada recupera su snapshot, no el último publicado en general', () => {
    expect(elegirPublicacion(todas, filtro)?.id).toBe('c');
    expect(elegirPublicacion(todas, { ...filtro, season: '2026-2027' })?.id).toBe('b');
  });

  it('una temporada sin publicación devuelve null y no cae en la más reciente de otra', () => {
    expect(elegirPublicacion(todas, { ...filtro, season: '2023-2024' })).toBeNull();
  });

  it('dentro de la temporada se puede pedir hasta un día; antes de la primera no hay nada', () => {
    expect(elegirPublicacion(todas, { ...filtro, hasta: '2026-01-31' })?.id).toBe('a');
    expect(elegirPublicacion(todas, { ...filtro, hasta: '2025-12-31' })).toBeNull();
  });

  it('individual y equipos no se mezclan, y la fuente tampoco', () => {
    expect(elegirPublicacion(todas, { ...filtro, season: '2026-2027', format: 'EQUIPOS' })?.id).toBe('d');
    expect(elegirPublicacion(todas, { ...filtro, source: 'fie_tiradores' })).toBeNull();
  });

  it('M10/M12 se piden por su categoría original y no se confunden con M13', () => {
    const m12 = p('m12', '2021-2022', '2026-03-01', { category: 'M12', categoryRaw: 'M12' });
    expect(elegirPublicacion([...todas, m12], { ...filtro, categoryRaw: 'M12' })?.id).toBe('m12');
    expect(elegirPublicacion(todas, { ...filtro, categoryRaw: 'M12' })).toBeNull();
  });
});
