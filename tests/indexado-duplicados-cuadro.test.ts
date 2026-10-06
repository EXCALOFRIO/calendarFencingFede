import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { type AsaltoCuadro, cabeEn, nombresDeCadena, planCuadro, type PuestoCuadro, rondaDirecta } from '../scripts/indexado/dedupe-cuadro';
import {
  anioTemporada,
  decidir,
  fundirPorEvidencia,
  mismoClub,
  nacimientoPorCategoria,
  normalizarClub,
  type PerfilEvidencia,
} from '../scripts/indexado/dedupe-evidencia';
import { vincularAsaltos } from '../scripts/indexado/vincular-asaltos';

// ------------------------------------------------------------------ cuadro (puro)

let k = 0;
/** Asalto de directa: `a` gana a `b` (15-x). Refs = nombre publicado salvo que se den. */
function directa(ronda: string, a: string, b: string, o: { ap?: string | null; bp?: string | null; ar?: string; br?: string } = {}): AsaltoCuadro {
  return { id: `t${(k += 1)}`, fase: 'TABLEAU', ronda, ar: o.ar ?? a, an: a, ap: o.ap ?? null, sa: 15, br: o.br ?? b, bn: b, bp: o.bp ?? null, sb: 9 };
}
function poule(ronda: string, a: string, b: string, o: { ap?: string | null; bp?: string | null } = {}): AsaltoCuadro {
  return { id: `p${(k += 1)}`, fase: 'POULE', ronda, ar: `poule:${a}`, an: a, ap: o.ap ?? null, sa: 5, br: `poule:${b}`, bn: b, bp: o.bp ?? null, sb: 3 };
}
const conId = (ids: string[]) => (r: string) => ({ conId: ids.includes(r), peso: ids.includes(r) ? 10 : 1 });

describe('dedupe-cuadro: piezas', () => {
  it('lee el tamaño de las rondas de directa de cada fuente', () => {
    expect(rondaDirecta('T16')).toEqual({ familia: 'T', tam: 16 });
    expect(rondaDirecta('A2')).toEqual({ familia: 'A', tam: 2 });
    expect(rondaDirecta('64')).toEqual({ familia: '', tam: 64 });
    expect(rondaDirecta('T12')).toBeNull();
    expect(rondaDirecta('V2P1')).toBeNull();
  });

  it('un nombre cabe en otro igual o más completo, nunca en uno más recortado', () => {
    expect(cabeEn('MARCOS PERAL Enri', 'MARCOS PERAL Enrique')).toBe(true);
    expect(cabeEn('MARCOS PERAL Enri', 'MARCOS PERAL')).toBe(false);
    expect(cabeEn('MARCOS PERAL', 'MARCOS PERAL Enrique')).toBe(true);
    expect(cabeEn('ROMERO ORTIN Hector', 'HECTOR ROMERO ORTIN')).toBe(true);
    expect(cabeEn('GONZALEZ ALMANCHA Sergio', 'GONZALEZ ALMARCHA Sergio')).toBe(true);
  });

  it('nombres de la misma cadena: recortes del PDF, orden distinto y erratas', () => {
    expect(nombresDeCadena('IBAÑEZ MARTIN Ce', 'IBAÑEZ MARTIN Celia')).toBe(true);
    expect(nombresDeCadena('FERNANDEZ CALLEJ', 'FERNANDEZ CALLEJA Sara')).toBe(true);
    expect(nombresDeCadena('ROMERO ORTIN Hector', 'HECTOR ROMERO ORTIN')).toBe(true);
    expect(nombresDeCadena('ZABALA GUTIERREZ Pedro', 'ZABALA GUTIERREZ Juan')).toBe(false);
    expect(nombresDeCadena('GARCIA LOPEZ Ana', 'GARCIA PEREZ Ana')).toBe(false);
  });
});

describe('dedupe-cuadro: planCuadro', () => {
  it('final Sub23: la cadena de la directa pasa la persona del puesto a los lados mal vinculados', () => {
    // Poule y directa con referencias distintas; la final quedó con una persona por nombre
    // («RAMIREZ LARENA Al») y el lado del ganador sin persona.
    const asaltos = [
      poule('P1', 'RAMIREZ LARENA Al', 'GUMA LEAL Arnau', { ap: 'fantasma', bp: 'guma' }),
      poule('P1', 'ZABALA GUTIERREZ', 'KIM YUOM San', { bp: 'kim' }),
      directa('A4', 'RAMIREZ LARENA Alejandro', 'GUMA LEAL Arnau', { ap: 'ale', bp: 'guma', ar: 'y684', br: 'y671' }),
      directa('A4', 'ZABALA GUTIERREZ Juan', 'KIM YUOM San', { ap: 'juan', bp: 'kim', ar: 'y698', br: 'y657' }),
      directa('A2', 'ZABALA GUTIERREZ Ju', 'RAMIREZ LARENA Al', { ap: null, bp: 'fantasma', ar: 'final:zg', br: 'final:rl' }),
    ];
    const puestos: PuestoCuadro[] = [
      { id: 'r1', nombre: 'ZABALA GUTIERREZ Juan', raiz: 'juan' },
      { id: 'r2', nombre: 'RAMIREZ LARENA Alejandro', raiz: 'ale' },
      { id: 'r3', nombre: 'GUMA LEAL Arnau', raiz: 'guma' },
      { id: 'r4', nombre: 'KIM YUOM San', raiz: 'kim' },
    ];
    const plan = planCuadro(asaltos, puestos, () => [], conId(['ale', 'juan', 'guma', 'kim']));
    expect(plan.aristas.cuadro).toBe(2);
    // La poule de «ZABALA GUTIERREZ» se une a la directa de Juan; la de «RAMIREZ LARENA Al» ya iba por su persona.
    expect(plan.aristas.poule).toBe(1);
    const final = plan.lados.filter((l) => l.asalto === asaltos[4].id).map((l) => [l.lado, l.raiz, l.previa]);
    expect(final.sort()).toEqual([['a', 'juan', null], ['b', 'ale', 'fantasma']]);
    // La poule de «RAMIREZ LARENA Al» también pasa a Alejandro; la persona fantasma es la de más.
    expect(plan.lados.find((l) => l.asalto === asaltos[0].id)).toMatchObject({ lado: 'a', raiz: 'ale', previa: 'fantasma' });
    expect(plan.conflictos).toEqual([{ principal: 'ale', extra: 'fantasma', nodos: 2 }]);
  });

  it('un ganador que reaparece con otra referencia en la ronda siguiente es el mismo tirador', () => {
    const asaltos = [
      directa('T16', 'IBAÑEZ MARTIN Ce', 'LOPEZ RODRIGUEZ Nahir', { ap: 'celia', bp: 'nahir' }),
      directa('T16', 'TORRENTE ROCA L', 'MESA CALLEJA Carmen', { ap: 'lucia', bp: 'carmen' }),
      directa('T8', 'TORRENTE ROCA Lucia', 'IBAÑEZ MARTIN Celia', { ap: 'lucia', bp: null }),
    ];
    const plan = planCuadro(asaltos, [], () => [], conId(['celia', 'lucia']));
    expect(plan.aristas.cuadro).toBe(1);
    expect(plan.lados).toEqual([{ asalto: asaltos[2].id, lado: 'b', raiz: 'celia', previa: null }]);
  });

  it('no une a un recorte con un puesto si hay un homónimo en la prueba (hermanos)', () => {
    const asaltos = [
      poule('P1', 'FLOREZ DE VARGAS', 'GOMEZ GIL Luis', { bp: 'luis' }),
      poule('P2', 'FLOREZ DE VARGAS Pedro', 'PEREZ SOLA Pepe', { bp: 'pepe' }),
    ];
    const puestos: PuestoCuadro[] = [
      { id: 'r1', nombre: 'FLOREZ DE VARGAS Juan', raiz: 'juan' },
      { id: 'r2', nombre: 'GOMEZ GIL Luis', raiz: 'luis' },
      { id: 'r3', nombre: 'PEREZ SOLA Pepe', raiz: 'pepe' },
    ];
    const plan = planCuadro(asaltos, puestos);
    expect(plan.aristas.clasificacion).toBe(0);
    expect(plan.lados).toEqual([]);
  });

  it('entre una persona con identificador y una creada por nombre manda la del identificador', () => {
    // El puesto (recortado) es de la persona por nombre; la directa, de la persona con ID FIE.
    const asaltos = [
      poule('P2', 'ZABALA GUTIERRE', 'MARCOS PERAL Enri', { ap: 'zgtrunc', bp: 'marcos' }),
      directa('T32', 'ZABALA GUTIERREZ Juan', 'VARGAS ESCOBAR Tomas', { ap: 'juan', bp: 'vargas' }),
    ];
    const puestos: PuestoCuadro[] = [
      { id: 'r1', nombre: 'ZABALA GUTIE', raiz: 'zgtrunc' },
      { id: 'r2', nombre: 'MARCOS PERAL Enrique', raiz: 'marcos' },
      { id: 'r3', nombre: 'VARGAS ESCOBAR Tomas', raiz: 'vargas' },
    ];
    const plan = planCuadro(asaltos, puestos, () => [], conId(['juan', 'marcos', 'vargas']));
    expect(plan.conflictos).toEqual([{ principal: 'juan', extra: 'zgtrunc', nodos: 2 }]);
    expect(plan.puestos).toEqual([{ id: 'r1', raiz: 'juan' }]);
    expect(plan.lados).toEqual([{ asalto: asaltos[0].id, lado: 'a', raiz: 'juan', previa: 'zgtrunc' }]);
  });

  it('la cadena no pasa a un hermano cuyo nombre no casa con el de la poule (MARCOS PERAL)', () => {
    // El puesto recortado «MARCOS PERAL» se vinculó a Alvaro; la poule dice «Enri» y la directa, Enrique.
    const asaltos = [
      poule('P2', 'MARCOS PERAL Enri', 'ZABALA GUTIERRE', { ap: 'alvaro', bp: 'juan' }),
      directa('T32', 'GONZALEZ ANDRE Gabriel', 'MARCOS PERAL Enrique', { ap: 'gabriel', bp: 'enrique' }),
    ];
    const puestos: PuestoCuadro[] = [
      { id: 'r1', nombre: 'MARCOS PERAL', raiz: 'alvaro' },
      { id: 'r2', nombre: 'GONZALEZ ANDRE Gabriel', raiz: 'gabriel' },
    ];
    const variantes = (r: string) => ({ alvaro: ['MARCOS PERAL Alvaro'], enrique: ['MARCOS PERAL Enrique'] } as Record<string, string[]>)[r] ?? [];
    const plan = planCuadro(asaltos, puestos, variantes, conId(['alvaro', 'enrique', 'gabriel', 'juan']));
    expect(plan.conflictos).toEqual([{ principal: 'enrique', extra: 'alvaro', nodos: 2 }]);
    expect(plan.puestos).toEqual([{ id: 'r1', raiz: 'enrique' }]);
    expect(plan.lados.every((l) => l.raiz === 'enrique')).toBe(true);
    // Si ninguna casa con todos los nombres, no se toca nada.
    const sinEnrique = planCuadro(asaltos.map((b) => (b.bp === 'enrique' ? { ...b, bn: 'MARCOS PERAL Alvaro J' } : b)), puestos, variantes,
      conId(['alvaro', 'enrique', 'gabriel', 'juan']));
    expect(sinEnrique.lados.filter((l) => l.raiz === 'alvaro' || l.raiz === 'enrique')).toEqual([]);
  });

  it('dos personas con identificador sin puesto que decida: no se toca', () => {
    const asaltos = [
      poule('P1', 'GARCIA PRADO S', 'X Y Z', { ap: 'fie1' }),
      directa('T16', 'GARCIA PRADO Santiago', 'A B C', { ap: 'fie2' }),
    ];
    // Dos IDs FIE con el mismo nombre (duplicados en la FIE): los dos casan con toda la cadena.
    const plan = planCuadro(asaltos, [], () => ['GARCIA PRADO Santiago'], conId(['fie1', 'fie2']));
    expect(plan.sinPrincipal).toBe(1);
    expect(plan.lados).toEqual([]);
  });
});

// ------------------------------------------------------------------ cuadro (base)

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}
type OpcionesPersona = { genero?: 'M' | 'F' | null; fie?: string; fuente?: string; pais?: string | null };
function persona(db: DatabaseSync, id: string, nombre: string, o: OpcionesPersona = {}) {
  const fuente = o.fuente ?? (o.fie ? 'fie' : 'rfee_pdf');
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero === undefined ? 'M' : o.genero, o.pais === undefined ? (o.fie ? 'ESP' : null) : o.pais);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`)
    .run(id, fuente, nombre, normalizarNombre(nombre));
  if (o.fie) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`)
      .run(id, o.fie);
  }
}
let n = 0;
function puesto(db: DatabaseSync, comp: string, nombre: string, p: string | null, club: string | null = null, source = 'rfee_pdf') {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_club, position, content_hash)
    VALUES (?,?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `k${n}`, p, nombre, club, n);
}
function asalto(db: DatabaseSync, comp: string, fase: string, ronda: string, a: [string, string, string | null], b: [string, string, string | null], sa = 15, sb = 9) {
  const [x, y, s1, s2] = a[0] < b[0] ? [a, b, sa, sb] : [b, a, sb, sa];
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
    fencer_a_person_id, fencer_b_person_id, score_a, score_b, content_hash) VALUES (?,?,'rfee_pdf',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`b${(n += 1)}`, comp, fase, ronda, x[0], y[0], x[1], y[1], x[2], y[2], s1, s2, `h${n}`);
}
const fila = (db: DatabaseSync, sql: string, ...a: string[]) => db.prepare(sql).get(...a) as Record<string, unknown>;
const fusionada = (db: DatabaseSync, id: string) => fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id = ?`, id).m;

function competiciones(db: DatabaseSync) {
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
      ('e1', 'rfee_pdf', '2022-2023', 'pdf:1', 'Campeonato de España Sub23'), ('e2', 'rfee_pdf', '2018-2019', 'pdf:2', 'TNR'),
      ('e3', 'rfee_pdf', '2019-2020', 'pdf:3', 'TNR');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES
      ('sub23', 'e1', 'rfee_pdf', '2022-2023', 'pdf:1:1', 'FLORETE', 'M', 'M23'),
      ('abs19', 'e2', 'rfee_pdf', '2018-2019', 'pdf:2:1', 'FLORETE', 'M', 'ABS'),
      ('m20', 'e3', 'rfee_pdf', '2019-2020', 'pdf:3:1', 'FLORETE', 'M', 'M20'),
      ('abs20', 'e3', 'rfee_pdf', '2019-2020', 'pdf:3:2', 'FLORETE', 'M', 'ABS'),
      ('esp20', 'e3', 'rfee_pdf', '2019-2020', 'pdf:3:3', 'ESPADA', 'M', 'ABS'),
      ('esp20f', 'e3', 'rfee_pdf', '2019-2020', 'pdf:3:4', 'ESPADA', 'F', 'ABS'),
      ('esp19f', 'e2', 'rfee_pdf', '2018-2019', 'pdf:2:2', 'ESPADA', 'F', 'ABS');`);
}

describe('vincularAsaltos: continuidad del cuadro', () => {
  it('la final mal vinculada pasa a sus finalistas; la persona fantasma queda vacía sin fundirse', () => {
    const db = crearBase();
    competiciones(db);
    persona(db, 'ale', 'RAMIREZ LARENA Alejandro', { fie: '51361' });
    persona(db, 'juan', 'ZABALA GUTIERREZ Juan', { fie: '49385' });
    persona(db, 'guma', 'GUMA LEAL Arnau', { fie: '1' });
    persona(db, 'kim', 'KIM YUOM San', { fie: '2' });
    // Recortes que el nombre solo no resuelve (palabra cortada a media): sólo los une el cuadro.
    persona(db, 'fantasma', 'RAMIREZ LAREN', { genero: null });
    puesto(db, 'sub23', 'ZABALA GUTIERREZ Juan', 'juan');
    puesto(db, 'sub23', 'RAMIREZ LARENA Alejandro', 'ale');
    puesto(db, 'sub23', 'GUMA LEAL Arnau', 'guma');
    puesto(db, 'sub23', 'KIM YUOM San', 'kim');
    asalto(db, 'sub23', 'TABLEAU', 'A4', ['y684', 'RAMIREZ LARENA Alejandro', 'ale'], ['y671', 'GUMA LEAL Arnau', 'guma']);
    asalto(db, 'sub23', 'TABLEAU', 'A4', ['y698', 'ZABALA GUTIERREZ Juan', 'juan'], ['y657', 'KIM YUOM San', 'kim']);
    asalto(db, 'sub23', 'TABLEAU', 'A2', ['f:zg', 'ZABALA GUTIERR', null], ['f:rl', 'RAMIREZ LAREN', 'fantasma']);
    const { informe, propuestas } = vincularAsaltos(db);
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE round_key = 'A2'`)).toEqual({ a: 'ale', b: 'juan' });
    expect(informe.cuadro).toMatchObject({ aristas: { cuadro: 2 }, ladosVinculados: 1, ladosRevinculados: 1, fusiones: 0, vaciasPorNombre: 1 });
    // Su nombre recortado no pasa a Alejandro: el paso por nombre no le daría puestos de otro.
    expect(fusionada(db, 'fantasma')).toBeNull();
    expect(fila(db, `SELECT count(*) n FROM sport_bout WHERE fencer_a_person_id = 'fantasma' OR fencer_b_person_id = 'fantasma'`)).toEqual({ n: 0 });
    expect(propuestas.some((p) => p.tipo === 'cuadro')).toBe(false);
    // Idempotente: una segunda pasada no cambia nada.
    const segunda = vincularAsaltos(db).informe;
    expect(segunda.cuadro).toMatchObject({ ladosVinculados: 0, ladosRevinculados: 0, fusiones: 0 });
  });

  it('una persona con identificador que se queda sin hechos se funde en la de su cadena', () => {
    const db = crearBase();
    competiciones(db);
    persona(db, 'ale', 'RAMIREZ LARENA Alejandro', { fie: '51361' });
    persona(db, 'guma', 'GUMA LEAL Arnau', { fie: '1' });
    // Ficha Skermo sin puestos propios a la que se vinculó por nombre el lado de la final.
    persona(db, 'ficha', 'RAMIREZ LAREN', { fuente: 'skermo_rfee' });
    puesto(db, 'sub23', 'RAMIREZ LARENA Alejandro', 'ale');
    puesto(db, 'sub23', 'GUMA LEAL Arnau', 'guma');
    asalto(db, 'sub23', 'TABLEAU', 'A4', ['y684', 'RAMIREZ LARENA Alejandro', 'ale'], ['y671', 'GUMA LEAL Arnau', 'guma']);
    asalto(db, 'sub23', 'TABLEAU', 'A2', ['f:rl', 'RAMIREZ LAREN', 'ficha'], ['f:x', 'X Y Z', null]);
    const { informe, propuestas } = vincularAsaltos(db);
    expect(informe.cuadro).toMatchObject({ ladosRevinculados: 1, fusiones: 1 });
    expect(fusionada(db, 'ficha')).toBe('ale');
    expect(propuestas.some((p) => p.tipo === 'cuadro' && p.aplicada)).toBe(true);
    expect(fila(db, `SELECT count(*) n FROM sport_link_candidate WHERE source = 'fusion_cuadro' AND status = 'CONFIRMADO'`)).toEqual({ n: 1 });
  });

  it('una persona de más con hechos fuera de la cadena sólo pierde los lados de la cadena y queda propuesta', () => {
    const db = crearBase();
    competiciones(db);
    persona(db, 'juan', 'ZABALA GUTIERREZ Juan', { fie: '49385' });
    persona(db, 'kim', 'KIM YUOM San', { fie: '2' });
    // Con una errata que el vínculo por nombre de la prueba no acepta.
    persona(db, 'otro', 'ZABALA GUTIERRES Juan', { genero: null });
    puesto(db, 'sub23', 'ZABALA GUTIERREZ Juan', 'juan');
    puesto(db, 'sub23', 'KIM YUOM San', 'kim');
    puesto(db, 'abs19', 'ZABALA GUTIERRES Juan', 'otro');
    asalto(db, 'sub23', 'POULE', 'P1', ['p:zg', 'ZABALA GUTIERRES Juan', 'otro'], ['p:kim', 'KIM YUOM San', 'kim'], 5, 3);
    asalto(db, 'sub23', 'TABLEAU', 'A2', ['a2:zg', 'ZABALA GUTIERREZ Juan', 'juan'], ['a2:kim', 'KIM YUOM San', 'kim']);
    const { informe, propuestas } = vincularAsaltos(db);
    const poule = fila(db, `SELECT fencer_a_name an, fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE round_key = 'P1'`);
    expect(poule.an === 'KIM YUOM San' ? poule.b : poule.a).toBe('juan');
    expect(informe.cuadro.fusiones).toBe(0);
    expect(fusionada(db, 'otro')).toBeNull();
    expect(propuestas.filter((p) => p.tipo === 'cuadro_misma_persona').map((p) => [p.origen.id, p.destino.id])).toEqual([['otro', 'juan']]);
  });

  it('sin la opción `cuadro` no hace nada de esto', () => {
    const db = crearBase();
    competiciones(db);
    persona(db, 'juan', 'ZABALA GUTIERREZ Juan', { fie: '49385' });
    persona(db, 'kim', 'KIM YUOM San', { fie: '2' });
    puesto(db, 'sub23', 'ZABALA GUTIERREZ Juan', 'juan');
    puesto(db, 'sub23', 'KIM YUOM San', 'kim');
    asalto(db, 'sub23', 'TABLEAU', 'A4', ['y698', 'ZABALA GUTIERREZ Juan', 'juan'], ['y657', 'KIM YUOM San', 'kim']);
    asalto(db, 'sub23', 'TABLEAU', 'A2', ['f:zg', 'ZABALA GUTIERR', null], ['f:x', 'X Y Z', null]);
    vincularAsaltos(db, { cuadro: false });
    expect(fila(db, `SELECT count(*) n FROM sport_bout WHERE round_key = 'A2' AND (fencer_a_person_id = 'juan' OR fencer_b_person_id = 'juan')`)).toEqual({ n: 0 });
  });
});

// ------------------------------------------------------------------ evidencia (puro)

function perfil(id: string, o: Partial<PerfilEvidencia> & { clubesLista?: [string, number[]][] } = {}): PerfilEvidencia {
  const { clubesLista, ...resto } = o;
  return {
    id, nombre: id, genero: 'M', fie: false, licencia: false, atleta: false, soloNombre: false,
    clubes: new Map((clubesLista ?? []).map(([c, as]) => [c, new Set(as)])), armas: new Set(['FLORETE']), anios: new Set([2019]),
    nacimiento: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY], fechas: new Set(), compsPuesto: new Set(), rondas: new Set(),
    ...resto,
  };
}

describe('dedupe-evidencia: piezas', () => {
  it('normaliza el código de club y compara recortes del PDF', () => {
    expect(['ATENEO-M', 'ATENEO-M (ESP)', 'ATENEO-M1', 'ATENEO-', 'ATENEO'].map(normalizarClub))
      .toEqual(['ATENEO-M', 'ATENEO-M', 'ATENEO-M', 'ATENEO', 'ATENEO']);
    expect(normalizarClub('FED-EXT')).toBeNull();
    expect(normalizarClub(null)).toBeNull();
    expect(mismoClub('ATENEO-M', 'ATENEO')).toBe(true);
    expect(mismoClub('ATEN', 'ATENEO-M')).toBe(true);
    expect(mismoClub('CE-M', 'CE-B')).toBe(false);
    expect(mismoClub('CESS-M', 'CSS')).toBe(false);
  });

  it('años de nacimiento por categoría y temporada', () => {
    expect(anioTemporada('2018-2019')).toBe(2019);
    expect(anioTemporada('2024')).toBe(2024);
    expect(nacimientoPorCategoria('M15', 2019)).toEqual([2003, Number.POSITIVE_INFINITY]);
    expect(nacimientoPorCategoria('VET', 2020)).toEqual([Number.NEGATIVE_INFINITY, 1981]);
    expect(nacimientoPorCategoria('ABS', 2020)).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]);
  });
});

describe('dedupe-evidencia: decidir', () => {
  const corto = perfil('RAMIREZ LARENA', { soloNombre: true, clubesLista: [['ATENEO-M', [2020]]], anios: new Set([2020]) });
  const ale = perfil('RAMIREZ LARENA Alejandro', {
    fie: true, clubesLista: [['ATENEO', [2019, 2020, 2021]], ['CESS-M', [2016]]], anios: new Set([2016, 2019, 2020, 2021, 2024]),
  });

  it('una sola candidata con el mismo club, arma y carrera: se funde', () => {
    expect(decidir(corto, [ale], 'recortado')).toMatchObject({ tipo: 'fundir', destino: { id: ale.id }, evidencia: 'recortado:club:ATENEO-M+arma+carrera' });
  });

  it('sin club publicado no hay apoyo', () => {
    expect(decidir({ ...corto, clubes: new Map() }, [ale], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'sin_club' });
  });

  it('dos hermanos del mismo club y arma: no se elige (FLOREZ DE VARGAS)', () => {
    const x = perfil('FLOREZ DE VARGAS', { soloNombre: true, clubesLista: [['CEM-M', [2019]]] });
    const juan = perfil('FLOREZ DE VARGAS Juan', { clubesLista: [['CEM-M', [2018, 2019]]], anios: new Set([2018, 2019]) });
    const pedro = perfil('FLOREZ DE VARGAS Pedro', { clubesLista: [['CEM-M', [2019, 2020]]], anios: new Set([2019, 2020]) });
    expect(decidir(x, [juan, pedro], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'varias_con_apoyo' });
  });

  it('una hermana sin club en esas temporadas sigue siendo posible (TORREGO)', () => {
    const x = perfil('TORREGO ALVAREZ', { genero: 'F', soloNombre: true, clubesLista: [['SAM-M', [2019]]], armas: new Set(['ESPADA']) });
    const ana = perfil('TORREGO ALVAREZ Ana', { genero: 'F', clubesLista: [['SAM-M', [2019]]], armas: new Set(['ESPADA']) });
    const eva = perfil('TORREGO ALVAREZ Eva', { genero: 'F', armas: new Set(['ESPADA']) });
    expect(decidir(x, [ana, eva], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'otra_candidata_posible' });
    // Con otro club conocido esas temporadas, la otra hermana queda descartada.
    const evaOtroClub = { ...eva, clubes: new Map([['CEV-V', new Set([2019])]]) };
    expect(decidir(x, [ana, evaOtroClub], 'recortado')).toMatchObject({ tipo: 'fundir', destino: { id: ana.id } });
  });

  it('el género y la coincidencia en una prueba descartan candidatas (DIAZ ESCALONA)', () => {
    const x = perfil('DIAZ ESCALONA', { genero: 'F', soloNombre: true, clubesLista: [['CCC-M', [2019]]], compsPuesto: new Set(['c9']) });
    const mario = perfil('DIAZ ESCALONA Mario', { genero: 'M', clubesLista: [['CCC-M', [2019]]] });
    const maite = perfil('DIAZ ESCALONA Maria Teresa', { genero: 'F', clubesLista: [['CCC-M', [2019]]] });
    expect(decidir(x, [mario, maite], 'recortado')).toMatchObject({ tipo: 'fundir', destino: { id: maite.id } });
    const maiteCoincide = { ...maite, compsPuesto: new Set(['c9']) };
    expect(decidir(x, [mario, maiteCoincide], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'sin_apoyo' });
  });

  it('coincidir con una hermana en una prueba no la descarta: el recorte puede juntar a los dos (MARCOS PERAL)', () => {
    const x = perfil('MARCOS PERAL', { soloNombre: true, clubesLista: [['CCC-M', [2019]]], compsPuesto: new Set(['c1', 'c2']) });
    const alvaro = perfil('MARCOS PERAL Alvaro', { clubesLista: [['CCC-M', [2019]]], compsPuesto: new Set(['c3']) });
    const enrique = perfil('MARCOS PERAL Enrique', { clubesLista: [['CCC-M', [2019]]], compsPuesto: new Set(['c1']) });
    expect(decidir(x, [alvaro, enrique], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'otra_candidata_posible' });
    // Tampoco la descarta la edad del conjunto: el M15 de 2020 no puede ser Enrique, el absoluto de 2019 sí.
    const inf = Number.POSITIVE_INFINITY;
    const mezcla = perfil('MARCOS PERAL', {
      soloNombre: true, clubesLista: [['CCC-M', [2019, 2020]]], anios: new Set([2019, 2020]), nacimiento: [2004, inf],
      puestos: [{ comp: 'm15', genero: 'M', nacimiento: [2004, inf] }, { comp: 'abs', genero: 'M', nacimiento: [-inf, inf] }],
    });
    const alvaroJoven = { ...alvaro, nacimiento: [2004, inf] as [number, number], anios: new Set([2018, 2019, 2020, 2021]) };
    const enriqueMayor = { ...enrique, fechas: new Set(['2001-05-01']), anios: new Set([2018, 2019, 2023]) };
    expect(decidir(mezcla, [alvaroJoven, enriqueMayor], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'otra_candidata_posible' });
    // Si todos sus puestos son de categorías que Enrique ya no podía tirar, sí se funde en Alvaro.
    const soloJoven = { ...mezcla, puestos: [mezcla.puestos![0]] };
    expect(decidir(soloJoven, [alvaroJoven, enriqueMayor], 'recortado')).toMatchObject({ tipo: 'fundir', destino: { id: alvaro.id } });
  });

  it('la edad por categoría contradice: M15 en 2019 no es VET en 2020', () => {
    const x = perfil('LOPEZ GIL', { soloNombre: true, clubesLista: [['CE-M', [2020]]], anios: new Set([2020]), nacimiento: [Number.NEGATIVE_INFINITY, 1981] });
    const y = perfil('LOPEZ GIL Pablo', { clubesLista: [['CE-M', [2019, 2020]]], anios: new Set([2019, 2020]), nacimiento: [2003, Number.POSITIVE_INFINITY] });
    expect(decidir(x, [y], 'recortado')).toEqual({ tipo: 'rechazar', motivo: 'edad' });
  });

  it('FIE: arma, carrera y una fecha FIE dentro de lo que permiten las categorías nacionales', () => {
    const fie = perfil('FONT Marc', { fie: true, fechas: new Set(['2004-03-01']), anios: new Set([2022, 2023]) });
    const nacional = perfil('FONT DIMAS Marc', { anios: new Set([2019, 2020, 2021, 2022, 2023]), nacimiento: [2003, Number.POSITIVE_INFINITY] });
    expect(decidir(fie, [nacional], 'fie')).toMatchObject({ tipo: 'fundir', evidencia: 'fie:arma+carrera+edad' });
    const sinEdad = { ...nacional, nacimiento: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number] };
    expect(decidir(fie, [sinEdad], 'fie')).toEqual({ tipo: 'rechazar', motivo: 'sin_apoyo' });
  });
});

// ------------------------------------------------------------------ evidencia (base)

describe('fundirPorEvidencia', () => {
  it('funde «RAMIREZ LARENA» en Alejandro por club, arma y carrera, y deja a los hermanos', () => {
    const db = crearBase();
    competiciones(db);
    persona(db, 'ale', 'RAMIREZ LARENA Alejandro', { fie: '51361' });
    persona(db, 'corto', 'RAMIREZ LARENA', { genero: null });
    puesto(db, 'abs19', 'RAMIREZ LARENA Alejandro', 'ale', 'ATENEO-');
    puesto(db, 'm20', 'RAMIREZ LARENA Alejandro', 'ale', 'ATENEO-M');
    puesto(db, 'abs20', 'RAMIREZ LARENA', 'corto', 'ATENEO-M');
    // Hermanos del mismo club, arma y temporadas: el recorte común no se toca.
    persona(db, 'fjuan', 'FLOREZ DE VARGAS Juan');
    persona(db, 'fpedro', 'FLOREZ DE VARGAS Pedro');
    persona(db, 'fcorto', 'FLOREZ DE VARGAS', { genero: null });
    puesto(db, 'abs19', 'FLOREZ DE VARGAS Juan', 'fjuan', 'CEM-M');
    puesto(db, 'm20', 'FLOREZ DE VARGAS Pedro', 'fpedro', 'CEM-M');
    puesto(db, 'abs20', 'FLOREZ DE VARGAS', 'fcorto', 'CEM-M');
    // Hermanas: mismo arma y club; una por nombre recortado tampoco elige.
    persona(db, 'tana', 'TORREGO ALVAREZ Ana', { genero: 'F' });
    persona(db, 'teva', 'TORREGO ALVAREZ Eva', { genero: 'F' });
    persona(db, 'tcorto', 'TORREGO ALVAREZ', { genero: null });
    puesto(db, 'esp20f', 'TORREGO ALVAREZ Ana', 'tana', 'SAM-M');
    puesto(db, 'esp20f', 'TORREGO ALVAREZ Eva', 'teva', 'SAM-M');
    puesto(db, 'esp19f', 'TORREGO ALVAREZ', 'tcorto', 'SAM-M');
    const inf = fundirPorEvidencia(db);
    expect(fusionada(db, 'corto')).toBe('ale');
    expect(inf.recortado.fusiones).toBe(1);
    expect(fusionada(db, 'fcorto')).toBeNull();
    expect(fusionada(db, 'tcorto')).toBeNull();
    expect(fusionada(db, 'tana')).toBeNull();
    expect(fusionada(db, 'teva')).toBeNull();
    expect(fila(db, `SELECT source, evidence FROM sport_link_candidate WHERE source_ref = 'corto'`))
      .toEqual({ source: 'fusion_evidencia', evidence: 'recortado:club:ATENEO-M+arma+carrera' });
    // Idempotente.
    expect(fundirPorEvidencia(db).recortado.fusiones).toBe(0);
  });
});
