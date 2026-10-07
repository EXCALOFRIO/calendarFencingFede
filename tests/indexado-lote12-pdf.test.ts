import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { metadatosDeCabecera } from '@/lib/ingest/sources/rfee-pdf/cabecera';
import { claveRonda } from '@/lib/ingest/sources/rfee-pdf/cuadro';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { AsaltoPdf } from '@/lib/ingest/sources/rfee-pdf/tipos';
import type { AsaltoBase } from '../scripts/indexado/lote10-pdf-auditar';
import {
  asaltosFiables, reconciliarCuadro, validarCuadroPdf, type Correcciones12, type CuadroPdf,
} from '../scripts/indexado/lote12-pdf-auditar';
import { aplicarCorrecciones12, comprobarCuadros } from '../scripts/indexado/lote12-pdf-sustituir';
import { cabecera, fila, pagina, paginaClasificacion, paginaCuadro } from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://ejemplo.test/cuadro.pdf', docId: 'doc' };

describe('cabeceras en catalán, francés e inglés', () => {
  it('lee arma y género en catalán, francés e inglés, y la errata «femeniono»', () => {
    expect(metadatosDeCabecera(['TORNEIG SATÈL·LIT', 'Floret Masculí', 'Sabadell'])).toMatchObject({ arma: 'FLORETE', genero: 'M' });
    expect(metadatosDeCabecera(['TORNEIG', 'ESPASA FEMENÍ', 'M-15'])).toMatchObject({ arma: 'ESPADA', genero: 'F', categoria: 'M15' });
    expect(metadatosDeCabecera(['COUPE', 'Épée Dames', 'Individuel'])).toMatchObject({ arma: 'ESPADA', genero: 'F', formato: 'INDIVIDUAL' });
    expect(metadatosDeCabecera(['CUP', "Men's Sabre"])).toMatchObject({ arma: 'SABLE', genero: 'M' });
    expect(metadatosDeCabecera(['CTO VETERANOS', 'SABLE FEMENIONO'])).toMatchObject({ arma: 'SABLE', genero: 'F', cohorte: null });
  });

  it('«masculino y femenino» sigue sin un género, pero declara los dos', () => {
    const m = metadatosDeCabecera(['TLM VET 50', 'FLORETE MASCULINO Y FEMENINO']);
    expect(m.genero).toBeNull();
    expect(m.generosDeclarados).toEqual(['M', 'F']);
    expect(m.errores).toContain('La cabecera declara más de un género');
  });

  it('la subdivisión de la línea del arma no cambia para las cabeceras que ya se leían', () => {
    expect(metadatosDeCabecera(['TNR', 'ESPADA MASCULINA 2010'])).toMatchObject({ arma: 'ESPADA', genero: 'M', cohorte: '2010' });
    expect(metadatosDeCabecera(['TNR', 'FLORETE FEMENINO INDIVIDUAL'])).toMatchObject({ cohorte: null, formato: 'INDIVIDUAL' });
  });
});

const NOMBRES = [
  { puesto: '1', nombre: 'ALFA UNO Ana', club: 'CLUB-A' },
  { puesto: '2', nombre: 'BRAVO DOS Bea', club: 'CLUB-B' },
  { puesto: '3', nombre: 'CHARLIE TRES Cris', club: 'CLUB-C' },
  { puesto: '3', nombre: 'DELTA CUATRO Dora', club: 'CLUB-D' },
];
const semillas = [
  { semilla: 1, nombre: 'ALFA UNO Ana', club: 'CLUB-A' },
  { semilla: 4, nombre: 'DELTA CUATRO Dora', club: 'CLUB-D' },
  { semilla: 3, nombre: 'CHARLIE TRES Cris', club: 'CLUB-C' },
  { semilla: 2, nombre: 'BRAVO DOS Bea', club: 'CLUB-B' },
];
// Semillas en y = 700, 680, 660, 640: semifinales a media altura, final entre ambas.
const GANADORES = [
  { x: 297, y: 690, nombre: 'ALFA UNO Ana', marcador: '15/10' },
  { x: 297, y: 650, nombre: 'BRAVO DOS Bea', marcador: '15/12' },
  { x: 469, y: 670, nombre: 'ALFA UNO Ana', marcador: '15/13' },
];

describe('rótulos de ronda del cuadro', () => {
  it('«Semi-finals», «Demi-finales», «Finale» y «Tableau de N»', () => {
    expect(claveRonda('Semi-finals')).toBe('A4');
    expect(claveRonda('Demi-finales')).toBe('A4');
    expect(claveRonda('Semi-finais')).toBe('A4');
    expect(claveRonda('Finale')).toBe('A2');
    expect(claveRonda('Tableau de 16')).toBe('A16');
    expect(claveRonda('Quarts de finale')).toBe('A8');
  });

  it('con «Semi-finals» las semifinales son A4 y la final A2 (antes salían como final)', () => {
    const espada = cabecera('ESPADA MASCULINA');
    const l = leerResultadosPdf([paginaCuadro(1, espada, ['Semi-finals', 'Final'], semillas, GANADORES), paginaClasificacion(2, espada, NOMBRES)], CTX);
    const cuadro = l.pruebas[0].asaltos.filter((a) => a.fase === 'TABLEAU');
    expect(cuadro.map((a) => a.ronda).sort()).toEqual(['A2', 'A4', 'A4']);
    expect(l.pruebas[0].cobertura.cuadro.estado).toBe('completo');
  });

  it('un rótulo que no está encima de su columna invalida la página en vez de correr las rondas', () => {
    const espada = cabecera('ESPADA MASCULINA');
    // Un rótulo desconocido en la primera columna: «Final» sería el primero reconocido y rotularía las semifinales.
    const raro = paginaCuadro(1, espada, ['Ronda rara', 'Final'], semillas, GANADORES);
    const l = leerResultadosPdf([raro, paginaClasificacion(2, espada, NOMBRES)], CTX);
    const p = l.pruebas[0];
    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU')).toHaveLength(0);
    expect(p.rechazos.some((r) => /fuera de su columna/.test(r.motivo))).toBe(true);
    expect(p.cobertura.cuadro.estado).toBe('parcial');
  });
});

describe('PDF de Engarde en francés', () => {
  const cab = [fila(816, [255, 'Torneig Satèl·lit']), fila(800, [265, 'Floret Masculí']), fila(785, [278, 'Sabadell'])];
  const clasificacion = pagina(2, [
    ...cab,
    fila(761, [10, 'Classement général (ordre des rangs - 4 tireurs)']),
    fila(740, [16, 'rg'], [36, 'nom prénom'], [108, 'drap'], [132, 'nat.']),
    ...NOMBRES.map((t, i) => fila(724 - i * 14, [19, t.puesto], [36, t.nombre], [132, 'ESP'])),
  ]);
  // El cuadro publica la nación en lugar del club, como la clasificación.
  const cuadro = paginaCuadro(1, cab, ['Demi-finales', 'Finale'], semillas.map((s) => ({ ...s, club: 'ESP' })), GANADORES);

  it('atribuye la prueba y lee clasificación y cuadro', () => {
    const l = leerResultadosPdf([cuadro, clasificacion], CTX);
    expect(l.pruebas).toHaveLength(1);
    const p = l.pruebas[0];
    expect(p).toMatchObject({ arma: 'FLORETE', genero: 'M', formato: 'INDIVIDUAL' });
    expect(p.rechazos.map((r) => r.motivo)).toEqual(['La cabecera no declara una categoría reconocida']);
    expect(p.puestos.map((x) => [x.posicion, x.nombre, x.pais])).toEqual(NOMBRES.map((t) => [Number(t.puesto), t.nombre, 'ESP']));
    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU').map((a) => a.ronda).sort()).toEqual(['A2', 'A4', 'A4']);
  });
});

describe('pistas de la competición guardada', () => {
  const sinArma = [fila(810, [200, 'TNR INFANTIL M15 BARCELONA'])];
  const paginas = [paginaCuadro(1, sinArma, ['Semi-finals', 'Final'], semillas, GANADORES), paginaClasificacion(2, sinArma, NOMBRES)];

  it('sin pistas la prueba queda pendiente; con ellas se atribuye y se lee el cuadro', () => {
    expect(leerResultadosPdf(paginas, CTX).pruebas[0].estado).toBe('pendiente');
    const p = leerResultadosPdf(paginas, { ...CTX, pistas: { arma: 'FLORETE', genero: 'F' } }).pruebas[0];
    expect(p).toMatchObject({ arma: 'FLORETE', genero: 'F', categoria: 'M15' });
    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU')).toHaveLength(3);
  });

  it('una pista nunca contradice lo que la cabecera nombra', () => {
    const mixta = [fila(810, [200, 'TLM VET 50']), fila(796, [215, 'FLORETE MASCULINO Y FEMENINO'])];
    const l = (genero: 'M' | 'MIXTO') => leerResultadosPdf([paginaClasificacion(2, mixta, NOMBRES)], { ...CTX, pistas: { genero } }).pruebas[0];
    expect(l('M').genero).toBe('M');
    expect(l('MIXTO').estado).toBe('pendiente');
    const espada = cabecera('ESPADA MASCULINA');
    expect(leerResultadosPdf([paginaClasificacion(2, espada, NOMBRES)], { ...CTX, pistas: { arma: 'SABLE', genero: 'F' } }).pruebas[0])
      .toMatchObject({ arma: 'ESPADA', genero: 'M' });
  });
});

// ------------------------------------------------------------------ contraste con la base

const PDF_N = ['ALFA UNO Ana', 'BRAVO DOS Bea', 'CHARLIE TRES Cris', 'DELTA CUATRO Dora', 'ECO CINCO Eva', 'FOX SEIS Fe', 'GOLF SIETE Gema', 'HOTEL OCHO Hada'];
const ref = (i: number) => `p${i + 1}`;
const pdfAsalto = (ronda: string, i: number, j: number, pi: number, pj: number): AsaltoPdf => {
  const [a, b, sa, sb] = ref(i) < ref(j) ? [i, j, pi, pj] : [j, i, pj, pi];
  return { fase: 'TABLEAU', ronda, rondaOriginal: ronda, refA: ref(a), refB: ref(b), nombreA: PDF_N[a], nombreB: PDF_N[b], puntosA: sa, puntosB: sb,
    marcador: 'explicito', region: { pagina: 1, yMax: 700, yMin: 600 } };
};
/** Cuadro de 8 del PDF: A, B, C, D (puestos 1-4) ganan la tabla de 8; A gana la final a B. */
const CUADRO = [
  pdfAsalto('A8', 0, 7, 15, 3), pdfAsalto('A8', 3, 4, 15, 10), pdfAsalto('A8', 2, 5, 15, 9), pdfAsalto('A8', 1, 6, 15, 7),
  pdfAsalto('A4', 0, 3, 15, 12), pdfAsalto('A4', 1, 2, 15, 11),
  pdfAsalto('A2', 0, 1, 15, 13),
];
const PUESTOS = PDF_N.map((nombre, i) => ({ ref: ref(i), nombre, posicion: [1, 2, 3, 3, 5, 6, 7, 8][i] }));
const cuadroPdf = (cuadro = CUADRO, completo = true): CuadroPdf => ({ clave: 'doc:FLORETE:F', cuadro, completo, puestos: PUESTOS, fallos: validarCuadroPdf(cuadro, PUESTOS) });

const BASE_REF = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const guardado = (ronda: string, i: number, j: number, si: number, sj: number, nombres = PDF_N): AsaltoBase => {
  const [a, b, sa, sb] = BASE_REF[i] < BASE_REF[j] ? [i, j, si, sj] : [j, i, sj, si];
  return { id: `${ronda}${BASE_REF[a]}${BASE_REF[b]}`, competicion: 'c1', fase: 'TABLEAU', ronda, aRef: BASE_REF[a], bRef: BASE_REF[b],
    aNombre: nombres[a], bNombre: nombres[b], aPersona: `per-${BASE_REF[a]}`, bPersona: `per-${BASE_REF[b]}`, sa, sb, url: 'u' };
};
const BIEN = [
  guardado('T8', 0, 7, 15, 3), guardado('T8', 3, 4, 15, 10), guardado('T8', 2, 5, 15, 9), guardado('T8', 1, 6, 15, 7),
  guardado('T4', 0, 3, 15, 12), guardado('T4', 1, 2, 15, 11), guardado('T2', 0, 1, 15, 13),
];

describe('reconciliación del cuadro guardado con el del PDF', () => {
  it('el cuadro del PDF pasa la validación contra su clasificación', () => {
    expect(validarCuadroPdf(CUADRO, PUESTOS)).toEqual([]);
    expect(asaltosFiables(cuadroPdf()).size).toBe(CUADRO.length);
  });

  it('igual que el del PDF: coincide sin cambios', () => {
    expect(reconciliarCuadro(BIEN, cuadroPdf(), [])).toMatchObject({ estado: 'coincide', motivo: null, cambios: [], pdfEntero: true });
  });

  it('ganador equivocado en la tabla de 8 y arrastrado a semifinales: marcador más sustitución en la ronda siguiente', () => {
    // La lectura antigua dio la victoria a E (puesto 5) y la llevó a semifinales contra A.
    const mal = BIEN.map((b) => (b.id === 'T8de' ? { ...b, sa: 10, sb: 15 } : b)).filter((b) => b.id !== 'T4ad').concat(guardado('T4', 0, 4, 15, 12));
    const r = reconciliarCuadro(mal, cuadroPdf(), []);
    expect(r.estado).toBe('corregido');
    expect(r.cambios.map((c) => [c.ronda, c.cambio.tipo, c.cambio.aRef, c.cambio.bRef])).toEqual([
      ['T8', 'marcador', 'd', 'e'], ['T4', 'baja', 'a', 'e'], ['T4', 'alta', 'a', 'd'],
    ]);
    expect(r.cambios.find((c) => c.cambio.tipo === 'alta')?.cambio).toMatchObject({ aNombre: PDF_N[0], bNombre: PDF_N[3], aPersona: 'per-a', bPersona: 'per-d', despues: [15, 12] });
  });

  it('un asalto del PDF que contradice la clasificación no corrige nada', () => {
    // El PDF da ganadora a E (puesto 5) frente a D (puesto 3): D no puede perder en la tabla de 8.
    const pdf = cuadroPdf(CUADRO.map((a) => (a.refA === 'p4' && a.refB === 'p5' ? { ...a, puntosA: 10, puntosB: 15 } : a)));
    const r = reconciliarCuadro(BIEN, pdf, []);
    expect(r.estado).toBe('dudoso');
    expect(r.cambios).toEqual([]);
    expect(r.motivo).toMatch(/no_fiables/);
  });

  it('un marcador imposible («157/0») no se usa', () => {
    const pdf = cuadroPdf(CUADRO.map((a) => (a.refA === 'p1' && a.refB === 'p8' ? { ...a, puntosA: 157, puntosB: 0 } : a)));
    expect(pdf.fallos).toContain('marcador_imposible:1');
    const r = reconciliarCuadro(BIEN.map((b) => (b.id === 'T8ah' ? { ...b, sb: 0 } : b)), pdf, []);
    expect(r.cambios).toEqual([]);
    expect(r.estado).toBe('dudoso');
  });

  it('el cruce que falta se da de alta con un tirador que sólo está en otra fase de la competición', () => {
    const sinUno = BIEN.filter((b) => b.id !== 'T8ah' && b.id !== 'T2ab');
    const r = reconciliarCuadro(sinUno, cuadroPdf(), [{ ref: 'h', nombre: 'HOTEL OCHO H', persona: 'per-h' }]);
    expect(r.estado).toBe('corregido');
    expect(r.cambios.map((c) => [c.ronda, c.cambio.tipo, c.cambio.aRef, c.cambio.bRef])).toEqual([['T8', 'alta', 'a', 'h'], ['T2', 'alta', 'a', 'b']]);
  });

  it('un tirador guardado dos veces en el cuadro no recibe altas', () => {
    const gemela: AsaltoBase = { ...guardado('T4', 0, 3, 15, 12), id: 'T4ad2', bRef: 'd2', bNombre: 'DELTA CUATRO D', bPersona: 'per-d2' };
    const conGemela = BIEN.filter((b) => b.id !== 'T4ad').concat(gemela);
    const r = reconciliarCuadro(conGemela, cuadroPdf(), []);
    expect(r.cambios.some((c) => c.cambio.tipo === 'alta')).toBe(false);
    expect(r.estado).toBe('dudoso');
  });

  it('sin el cuadro entero no se borra lo que el PDF no publica', () => {
    const extra = [...BIEN, guardado('T8', 4, 5, 15, 2)];
    expect(reconciliarCuadro(extra, cuadroPdf(CUADRO, false), []).cambios).toEqual([]);
    expect(reconciliarCuadro(extra, cuadroPdf(CUADRO, true), []).cambios.map((c) => c.cambio.tipo)).toEqual(['baja']);
  });

  it('fase previa: no se mide contra la clasificación, pero el ganador tiene que tirar la ronda siguiente', () => {
    // Clasificación que ordena por el resultado final (los de la fase previa no cuadran con su tramo).
    const puestos = PUESTOS.map((p, i) => ({ ...p, posicion: [30, 12, 40, 7, 90, 80, 70, 60][i] }));
    const pdf: CuadroPdf = { clave: 'doc:F1', cuadro: CUADRO.filter((a) => a.ronda !== 'A2'), completo: true, puestos, fallos: [] };
    const mal = BIEN.filter((b) => b.ronda !== 'T2').map((b) => ({ ...b, ronda: b.ronda.replace('T', 'A') })).map((b) => (b.id === 'T4bc' ? { ...b, sa: 11, sb: 15 } : b));
    expect(reconciliarCuadro(mal, pdf, []).cambios).toEqual([]);
    const r = reconciliarCuadro(mal, pdf, [], true);
    expect(r.cambios.map((c) => [c.ronda, c.cambio.tipo, c.cambio.aRef, c.cambio.bRef])).toEqual([['A4', 'marcador', 'b', 'c']]);
    expect(r.estado).toBe('corregido');
  });
});

// ------------------------------------------------------------------ sustitución

describe('sustitución en memoria', () => {
  const base = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE sport_competition (id TEXT PRIMARY KEY, source TEXT, season TEXT, competition_key TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, source TEXT, phase TEXT, round_key TEXT, fencer_a_ref TEXT, fencer_b_ref TEXT,
        fencer_a_person_id TEXT, fencer_b_person_id TEXT, fencer_a_name TEXT, fencer_b_name TEXT, score_a INT, score_b INT, occurred_on TEXT, source_url TEXT,
        content_hash TEXT, revision INT, first_seen_at INT, revised_at INT, CHECK (fencer_a_ref < fencer_b_ref));
      CREATE UNIQUE INDEX k ON sport_bout (competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref);
      CREATE TABLE sport_import_coverage (id TEXT PRIMARY KEY, source TEXT, fact_kind TEXT, competition_id TEXT, status TEXT, last_error TEXT, updated_at INT);
      INSERT INTO sport_competition VALUES ('c1', 'skermo_rfee', '2025-2026', 'RFEE:1');
      INSERT INTO sport_bout VALUES ('b1', 'c1', 'rfee_pdf', 'TABLEAU', 'T8', 'd', 'e', 'pd', 'pe', 'D', 'E', 10, 15, '2025-11-29', 'u#p', 'h', 1, 0, 0);
      INSERT INTO sport_bout VALUES ('b2', 'c1', 'rfee_pdf', 'TABLEAU', 'T4', 'a', 'e', 'pa', 'pe', 'A', 'E', 15, 12, '2025-11-29', 'u#p', 'h', 1, 0, 0);
      INSERT INTO sport_import_coverage VALUES ('k1', 'rfee_pdf', 'tableau', 'c1', 'parcial', 'lote11: relectura del PDF sin evidencia completa (TABLEAU:correccion_empeora_coherencia)', 0);`);
    return db;
  };
  const competicion = { source: 'skermo_rfee', season: '2025-2026', competitionKey: 'RFEE:1' };
  const correcciones: Correcciones12 = {
    generado: '', base: '',
    fases: [
      { competicion, url: 'u', fase: 'TABLEAU', ronda: 'T8', extractor: 'droid', evidencia: { pagina: null, lector: 'x' },
        cambios: [{ tipo: 'marcador', aRef: 'd', bRef: 'e', antes: [10, 15], despues: [15, 10] }] },
      { competicion, url: 'u', fase: 'TABLEAU', ronda: 'T4', extractor: 'droid', evidencia: { pagina: null, lector: 'x' }, cambios: [
        { tipo: 'baja', aRef: 'a', bRef: 'e', antes: [15, 12] },
        { tipo: 'alta', aRef: 'a', bRef: 'd', aNombre: 'A', bNombre: 'D', aPersona: 'pa', bPersona: 'pd', despues: [15, 12] },
      ] },
    ],
    cobertura: [{ competicion, kind: 'tableau', estado: 'completo', motivo: null, pdfEntero: false }],
  };

  it('corrige el marcador, sustituye el cruce, restaura la cobertura del lote 11 y es idempotente', () => {
    const db = base();
    expect(comprobarCuadros(db, correcciones).cuadros).toBe(1);
    const inf = aplicarCorrecciones12(db, correcciones);
    expect(inf).toMatchObject({ aplicadas: 2, obsoletas: [], cambios: { 'TABLEAU:marcador': 1, 'TABLEAU:baja': 1, 'TABLEAU:alta': 1 }, cobertura: { restaurada: 1 } });
    expect(db.prepare(`SELECT round_key r, fencer_a_ref a, fencer_b_ref b, score_a sa, score_b sb, revision v, source_url u, occurred_on o FROM sport_bout ORDER BY r`).all())
      .toEqual([
        { r: 'T4', a: 'a', b: 'd', sa: 15, sb: 12, v: 1, u: 'u#p', o: '2025-11-29' },
        { r: 'T8', a: 'd', b: 'e', sa: 15, sb: 10, v: 2, u: 'u#p', o: '2025-11-29' },
      ]);
    expect(db.prepare(`SELECT status, last_error FROM sport_import_coverage`).get()).toEqual({ status: 'completo', last_error: null });
    expect(comprobarCuadros(db, correcciones)).toEqual({ cuadros: 1, incoherentes: [] });
    expect(aplicarCorrecciones12(db, correcciones)).toMatchObject({ aplicadas: 0, yaAplicadas: 2, cambios: {}, cobertura: { restaurada: 0 } });
  });

  it('una cobertura parcial de la carga sólo vuelve a completo con el cuadro del PDF entero', () => {
    const db = base();
    db.exec(`UPDATE sport_import_coverage SET last_error = '12 regiones y 11 cruces sin atribuir con seguridad'`);
    aplicarCorrecciones12(db, correcciones);
    expect(db.prepare(`SELECT status FROM sport_import_coverage`).get()).toEqual({ status: 'parcial' });
    aplicarCorrecciones12(db, { ...correcciones, cobertura: [{ ...correcciones.cobertura[0], pdfEntero: true }] });
    expect(db.prepare(`SELECT status FROM sport_import_coverage`).get()).toEqual({ status: 'completo' });
  });

  it('si un asalto cambió desde la auditoría, su fase entera se salta', () => {
    const db = base();
    db.exec(`UPDATE sport_bout SET score_b = 11 WHERE id = 'b2'`);
    const inf = aplicarCorrecciones12(db, correcciones);
    expect(inf.aplicadas).toBe(1);
    expect(inf.obsoletas).toEqual([{ prueba: 'RFEE:1', ronda: 'T4', motivo: 'baja_cambiada:15-11' }]);
    expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE round_key='T4' AND fencer_b_ref='e'`).get()).toEqual({ n: 1 });
  });
});
