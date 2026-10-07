import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cargarHechos } from '../scripts/indexado/cargar-hechos';
import { quitarGuardia } from '../scripts/indexado/comun';
import { codigoGeneroDeClave, decidirGeneroClave, diccionarioGeneroDeBase } from '../scripts/indexado/genero-clave';
import { auditarGeneroClave, aplicarGeneroClave } from '../scripts/indexado/lote13-genero';
import type { Genero } from '../scripts/indexado/separar-genero';

const FEMENINOS = `cristina dianicely mar araceli rosa paulina maria marta jasone georgina rosario dolores sol valerie sara elena beatriz isabel angela
  cayetana victoria raquel nieves eloisa sandra celia itziar lucia ines susana paula ainhoa gloria carmen carlota eva alejandra jana blanca anna
  patricia andrea marina ariadna berta paloma eleonora roseline ana clara claudia oksana zaida alba karmele`;
const MASCULINOS = `carlos roger ignacio guillermo jorge rafael pedro luis adrian gabriel julio joan pablo alvaro santiago mateu marcos miquel jaime javier
  oscar eric jose fernando sergio diego lucas andres inaki pepe marc daniel nil beltran pere alejandro victor miguel guillem esteban josep alejo
  cristian gerard yeray raul aleix cristobal jordi arnau bartomeu kevin jaume guifre lino lluis joaquin terence jonathan vladimir sergi nacho
  albert enzo carles oriol adria nestor`;
const DIC = new Map<string, Genero>([
  ...FEMENINOS.split(/\s+/).filter(Boolean).map((w) => [w, 'F'] as [string, Genero]),
  ...MASCULINOS.split(/\s+/).filter(Boolean).map((w) => [w, 'M'] as [string, Genero]),
]);

/** Clasificaciones reales (de los ficheros de hechos) de las cinco pruebas con el sexo al revés. */
const CASOS = [
  { clave: 'rfee-wayback:619/CTOESP-EFCATI(2011-05-14)', arma: 'ESPADA', fichero: 'M', bien: 'F', nombres: ['RUANO OLAIZ Cristina', 'MARIN CASTILLO Dianicely',
    'SANTAMARIA PUENTE Mar', 'BUGALLO OTERO Araceli', 'CANO DIOSA Rosa Maria', 'CLOSE Paulina', 'ATAURI SANCHEZ Maria Luisa Blanca', 'DIEZ PACHECO Marta',
    'FERNANDEZ GARCIA REVILLO Maria Carmen', 'SANCHEZ PEDRAZA Cristina', 'VICANDI EMBEITA Jasone', 'JOLIN GARIJO Georgina', 'ROVIRA SERENA Rosario',
    'ARRIBAS DEL AMO Dolores', 'COLLADO RUEDA Sol', 'MONTORO NAVAZO Marta', 'JAUDENES GUAL DE TORRELLA Valerie'] },
  { clave: 'rfee-wayback:824/FIESTA_SF-12', arma: 'SABLE', fichero: 'M', bien: 'F', nombres: ['CALDERON MONDRAGON Sara Isabel', 'VENTURA JORQUERA Maria',
    'HERNANDEZ CABALLERO Elena', 'SANGRO CID Beatriz', 'FERNANDEZ OLALLA Isabel', 'MADRIGAL DE RIOJA Angela', 'STAMPA SAUVAGEOT Cayetana', 'BARDINA DIAZ Maria',
    'GARCIA ALCOBENDAS Victoria', 'ROMERO GONZALEZ Raquel', 'MARTIN TOLEDANO GARCIA MAURIÑO Maria', 'PEREZ FERNAUD Nieves'] },
  { clave: 'engarde:rfee/191026tnrsable/sfabs', arma: 'SABLE', fichero: 'M', bien: 'F', nombres: ['VENTURA JORQUERA Maria', 'PASSARO Eloisa', 'MARCOS GARCIA Sandra',
    'NAVARRO LASO Araceli', 'ESTRADA GONZALEZ Sara', 'HERNANDEZ MUÑOZ Elena', 'MARTINEZ FRAGO Celia', 'GALLARDO GOMEZ Itziar', 'MARTIN PORTUGUES BARBERO Lucia',
    'TIRADO BARRIO Ines', 'CONTRERAS TEJERO Susana', 'MONTOYA GAMBAO Paula', 'PEREZ ZURUTUZA Ainhoa', 'AGUILAR FERNANDEZ MAYORALAS Gloria'] },
  { clave: 'engarde:fecyl/cespabs2016/fmind', arma: 'FLORETE', fichero: 'F', bien: 'M', nombres: ['LLAVADOR FERNANDEZ Carlos', 'GARCIA ALZORRIZ GUARDIOLA Roger',
    'BRETEAU IANNUZZI Ignacio', 'DELBERGUE CHICO Guillermo', 'HERNANDO SANZ Jorge', 'ESPERON FERNANDEZ Rafael', 'OTERO LOPEZ Pedro', 'DELBERGUE CHICO Luis Alfonso',
    'VILLAPALOS TORREJON Adrian', 'GARCIA APARICIO Gabriel', 'GONZALEZ ANDRE Julio', 'FERRERES SERAFINI Joan', 'AMBEL JIMENEZ Pablo'] },
  { clave: 'engarde:fecyl/cespabs2016/smind', arma: 'SABLE', fichero: 'F', bien: 'M', nombres: ['CASARES MONTOYA Fernando', 'ESCUDERO TARDON Sergio',
    'ESCUDERO TARDON Jorge', 'MORENO SANCHEZ Pablo', 'DE LA FUENTE MONEDERO Diego', 'CASANOVA GARCIA Lucas', 'SANTAMARIA GUILLEN Diego',
    'HERNANDEZ CABALLERO Andres', 'MANCHEÑO MERINO Guillermo', 'BRAVO ARAMBURU Iñaki', 'SERRAHIMA DE CAMBRA Pepe'] },
];

describe('lote 13: género desde la clave de Engarde', () => {
  it('lee el código del último segmento sin confundir fm17 (florete M17)', () => {
    expect(codigoGeneroDeClave('rfee-wayback:619/CTOESP-EFCATI(2011-05-14)')).toMatchObject({ arma: 'ESPADA', genero: 'F', codigo: 'efcati' });
    expect(codigoGeneroDeClave('rfee-wayback:824/FIESTA_SF-12')).toMatchObject({ arma: 'SABLE', genero: 'F', codigo: 'sf' });
    expect(codigoGeneroDeClave('engarde:rfee/191026tnrsable/sfabs')).toMatchObject({ arma: 'SABLE', genero: 'F' });
    expect(codigoGeneroDeClave('engarde:fecyl/cespabs2016/fmind')).toMatchObject({ arma: 'FLORETE', genero: 'M' });
    expect(codigoGeneroDeClave('engarde:fecyl/cespabs2016/smind')).toMatchObject({ arma: 'SABLE', genero: 'M' });
    expect(codigoGeneroDeClave('engarde:fce/fm17/fm17f')).toMatchObject({ arma: 'FLORETE', genero: 'F', codigo: 'fm17f' });
    expect(codigoGeneroDeClave('engarde:fce/fm17/fm17')).toBeNull();
    expect(codigoGeneroDeClave('engarde:fce/20160213lliga/ef')).toMatchObject({ arma: 'ESPADA', genero: 'F' });
    expect(codigoGeneroDeClave('rfee-wayback:627/EMACWMAD_2F_21MAY2011')).toBeNull();
    expect(codigoGeneroDeClave('engarde:rfee/cespvet2026/vet-ef-30-40')).toMatchObject({ arma: 'ESPADA', genero: 'F' });
    // Dos códigos que se contradicen: ninguno.
    expect(codigoGeneroDeClave('engarde:x/y/ef-em')).toBeNull();
  });

  it('corrige los cinco casos reales cuando los nombres confirman el código', () => {
    for (const c of CASOS) {
      const d = decidirGeneroClave({ competitionKey: c.clave, weapon: c.arma, gender: c.fichero, nombres: c.nombres }, DIC);
      expect([c.clave, d.accion, d.genero]).toEqual([c.clave, 'corregido', c.bien]);
    }
  });

  it('falsos positivos: lliga/ef masculina de verdad, fm17f femenina, arma distinta, prueba mixta y pocos nombres conocidos', () => {
    const hombres = ['MANZANARES TOMAS Guillem', 'BUSZOS RODRIGUEZ Esteban', 'MESTRES SANNA Josep', 'TORRES CANO Alejo', 'CHAMIZO BELLIDO Cristian',
      'GONELL TOMAS Gerard', 'GIL BARBERA Yeray', 'OLIAS GONZALEZ Raul'];
    expect(decidirGeneroClave({ competitionKey: 'engarde:fce/20160213lliga/ef', weapon: 'ESPADA', gender: 'M', nombres: hombres }, DIC))
      .toMatchObject({ accion: 'desmentido', genero: 'M' });
    const mujeres = ['BRETEAU IANNUZZI Andrea', 'OJEDA ESQUERDO Marina', 'CASTRO GARCIA Ariadna Fatima', 'GARCIA GONZALEZ Berta'];
    expect(decidirGeneroClave({ competitionKey: 'engarde:fce/fm17/fm17f', weapon: 'FLORETE', gender: 'F', nombres: mujeres }, DIC))
      .toMatchObject({ accion: 'coincide', genero: 'F' });
    expect(decidirGeneroClave({ competitionKey: 'engarde:x/y/sf', weapon: 'ESPADA', gender: 'M', nombres: mujeres }, DIC)).toMatchObject({ accion: 'sin_codigo', genero: 'M' });
    expect(decidirGeneroClave({ competitionKey: 'engarde:x/y/sf', weapon: 'SABLE', gender: 'MIXTO', nombres: mujeres }, DIC)).toMatchObject({ accion: 'mixta', genero: 'MIXTO' });
    const desconocidos = ['UNO Xq', 'DOS Yq', 'TRES Zq', 'CUATRO Wq', 'CINCO Vq', 'SEIS Uq', 'BRETEAU IANNUZZI Andrea'];
    expect(decidirGeneroClave({ competitionKey: 'engarde:x/y/sf', weapon: 'SABLE', gender: 'M', nombres: desconocidos }, DIC)).toMatchObject({ accion: 'dudoso', genero: 'M' });
    // Mitad y mitad: no está claro.
    expect(decidirGeneroClave({ competitionKey: 'engarde:x/y/sf', weapon: 'SABLE', gender: 'M', nombres: [...hombres.slice(0, 4), ...mujeres] }, DIC))
      .toMatchObject({ accion: 'dudoso', genero: 'M' });
  });

  function crearBase(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    return db;
  }
  const hechos = (clave: string, arma: string, genero: string, nombres: readonly string[]) => ({
    version: 1, source: 'engarde', extractor: 'lector_engarde_nativo', sourceUrl: 'https://web.archive.org/x', sourceSha256: 'a'.repeat(64),
    edition: { season: '2011-2012', tournamentKey: 'rfee-wayback:824', name: 'Fiesta', startDate: '2012-03-03', endDate: null, city: null, countryCode: null },
    competition: { competitionKey: clave, weapon: arma, gender: genero, category: 'M12', categoryRaw: null, format: 'INDIVIDUAL', date: '2012-03-03' },
    status: { results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: [] },
    results: nombres.map((name, i) => ({ factKey: `engarde:${i}`, name, position: i + 1 })),
    bouts: [],
  });

  it('cargar-hechos usa el género del código si los nombres lo confirman, y lo anota', () => {
    const db = crearBase();
    const [, fiesta] = CASOS;
    const i = cargarHechos(db, [
      { ruta: 'a.json', carpeta: 'rfee-wayback', leer: () => hechos(fiesta.clave, 'SABLE', 'M', fiesta.nombres) },
      { ruta: 'b.json', carpeta: 'rfee-wayback', leer: () => hechos('engarde:fce/20160213lliga/ef', 'ESPADA', 'M', ['MANZANARES TOMAS Guillem', 'MESTRES SANNA Josep', 'GIL BARBERA Yeray']) },
    ], { diccionarioGenero: DIC });
    expect(db.prepare(`SELECT competition_key k, gender g FROM sport_competition ORDER BY k`).all())
      .toEqual([{ k: 'engarde:fce/20160213lliga/ef', g: 'M' }, { k: 'rfee-wayback:824/FIESTA_SF-12', g: 'F' }]);
    expect(i.avisos).toMatchObject({ genero_clave_corregido: 1, genero_clave_desmentido: 1 });
    expect(i.generoClave.map((x) => [x.competitionKey, x.accion, x.fichero, x.genero])).toEqual([
      ['rfee-wayback:824/FIESTA_SF-12', 'corregido', 'M', 'F'], ['engarde:fce/20160213lliga/ef', 'desmentido', 'M', 'M'],
    ]);
    // Sin diccionario no se contrasta (comportamiento anterior).
    const otra = crearBase();
    cargarHechos(otra, [{ ruta: 'a.json', carpeta: 'x', leer: () => hechos(fiesta.clave, 'SABLE', 'M', fiesta.nombres) }]);
    expect(otra.prepare(`SELECT gender g FROM sport_competition`).get()).toEqual({ g: 'M' });
  });

  it('lote13-genero corrige en la base sólo los corregidos y es idempotente; el diccionario sale de la base', () => {
    const db = crearBase();
    const [efcati] = CASOS;
    cargarHechos(db, [{ ruta: 'a.json', carpeta: 'x', leer: () => hechos(efcati.clave, 'ESPADA', 'M', efcati.nombres) }]);
    const casos = auditarGeneroClave(db, DIC).filter((c) => c.decision.accion !== 'coincide' && c.decision.accion !== 'sin_codigo');
    expect(casos.map((c) => c.decision.accion)).toEqual(['corregido']);
    expect(aplicarGeneroClave(db, casos)).toBe(1);
    expect(db.prepare(`SELECT gender g FROM sport_competition`).get()).toEqual({ g: 'F' });
    expect(aplicarGeneroClave(db, casos)).toBe(0);
    expect(auditarGeneroClave(db, DIC).map((c) => c.decision.accion)).toEqual(['coincide']);
    // Diccionario aprendido de puestos de pruebas M o F (10 o más y 97 %).
    const nombres = Array.from({ length: 12 }, (_, k) => `APELLIDO${k} OTRO Cristina`);
    cargarHechos(db, [{ ruta: 'c.json', carpeta: 'x', leer: () => ({ ...hechos('engarde:a/b/c', 'ESPADA', 'F', nombres), edition: { ...hechos('', '', '', []).edition, tournamentKey: 't2' } }) }]);
    expect(diccionarioGeneroDeBase(db).get('cristina')).toBe('F');
  });
});
