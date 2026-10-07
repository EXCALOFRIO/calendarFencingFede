/**
 * Lote 11: decisiones tomadas tras revisar las fuentes a mano (calendario-trabajo/revision-genero/README.md).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote11-revision-manual.ts --db <copia.sqlite> [--aplicar] [--informe <json>]
 *
 * Sin `--aplicar` sólo informa (la copia se abre en sólo lectura). Se niega a escribir en las copias
 * exactas de producción (nuevo11, base, remoto).
 *
 * - Uniones: cada una deja un candidato CONFIRMADO con evidencia `revision_manual:<motivo>`, que
 *   `separar-uniones.ts` trata como prueba decisiva en los lotes siguientes.
 * - Género: dos pruebas del archivo de esgrima.es (Wayback) se cargaron como masculinas aunque su
 *   código dice lo contrario (EF = espada femenina, SF = sable femenino) y todas las clasificadas son
 *   mujeres; son las dos únicas pruebas de la base cuyo género contradice al de sus tiradores. Pasan a
 *   F, y también las fichas creadas como M a partir de ellas. Y al revés: dos pruebas masculinas del
 *   Campeonato de España absoluto de 2016 guardadas como F, con las fichas creadas sólo desde ellas.
 */
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  ahora, argumento, bandera, CARPETA_TRABAJO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid,
} from './comun';
import { FUSION_REVISION_MANUAL } from './separar-uniones';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo11.sqlite', 'nuevo12.sqlite']);
export const FUENTE_REVISION = 'revision_manual';

export const UNIONES_MANUALES: readonly { origen: string; destino: string; motivo: string }[] = [
  // «VILORIA Victor» (Engarde, Mediterranean Championship 2024, florete M17) → VILORIA STEPANOVA Victor Manuel (2008, florete).
  { origen: '32558c9c-e182-4eda-8f90-7ddf5bb21930', destino: 'be146791-057f-4599-b840-b8509f788d94', motivo: 'engarde_med2024_florete_m17_misma_edad' },
  // «VILORIA STEPAN» (PDF RFEE con el apellido cortado, club ATEN, TNR florete M15 2020-21) → la misma persona.
  { origen: '4815462d-7a75-40ed-bece-1c5140e777d4', destino: 'be146791-057f-4599-b840-b8509f788d94', motivo: 'pdf_apellido_cortado_club_ateneo_florete_m15' },
  // «PEÑAS GONZALEZ Marco Nuno» (PDF RFEE, apellidos invertidos) → MARCO NUNO GONZALEZ PEÑAS (2011, mismo club CDAXXI-SE).
  { origen: 'c82e2e5b-96b3-42d6-9545-c9f306caebb8', destino: '02563a42-e87f-4d3e-964f-842d70e4ec75', motivo: 'pdf_apellidos_invertidos_mismo_club_cdaxxi' },
  // «PONTE ALBALADEJO Antonio» (PDF RFEE, 2010, sable M10) → ANTONIO ALBALADEJO PONTE (2010, sable), ya publicado en orden correcto en otro PDF.
  { origen: 'f3bb3075-1ec5-4165-a836-f6a817737165', destino: '4271e8df-52d6-4ea3-8f02-11413e25ad7d', motivo: 'pdf_apellidos_invertidos_mismo_anio_y_arma' },
];

/** Uniones que una revisión posterior demostró equivocadas: la ficha vuelve a ser raíz. */
export const SEPARACIONES_MANUALES: readonly { persona: string; raiz: string; motivo: string }[] = [
  // Two «MARTIN LOPEZ RUIZ» (2009, same club): licences MLR08279 and MLO04728 in the same season, and both in the
  // 2023-24 M15 épée ranking (130th and 156th). Two boys, joined by lote 11's duplicate-record rule.
  { persona: '6426468e-be5d-4a64-8463-db338f4ccc8c', raiz: '98a8d01c-5a98-4676-8598-f1cff141b3d8', motivo: 'dos_licencias_misma_temporada_y_mismo_ranking' },
];

export const PRUEBAS_FEMENINAS: readonly string[] = [
  '5a1e6bf9-f239-4a6e-b091-e56f20ae6312', // rfee-wayback:619/CTOESP-EFCATI(2011-05-14), espada VET
  'a644758e-889c-4376-ba40-a2ba64941a52', // rfee-wayback:824/FIESTA_SF-12, sable M12
];

/**
 * The opposite case: the 2016 Spanish absolute championship stored men's foil and sabre as F (key codes
 * fmind/smind, 55 men such as LLAVADOR FERNANDEZ Carlos). Their records were created as F from these two
 * events only, so the gender blocked every merge with their real record.
 */
export const PRUEBAS_MASCULINAS: readonly string[] = [
  'c5a78aa4-f6bb-47e7-a7e6-f90a93349d0e', // engarde:fecyl/cespabs2016/fmind
  '02b259ed-55f4-4479-bb68-639b164a3963', // engarde:fecyl/cespabs2016/smind
];

/** Fichas creadas como M desde esas dos pruebas (todas mujeres; las 7 fundidas ya cuelgan de su ficha F). */
export const FICHAS_FEMENINAS: readonly string[] = [
  '5565c0a2-166e-41cd-9f16-3ccec516a873', // ARRIBAS DEL AMO Dolores
  '9b630c92-fc1a-4e4d-9369-93f4d7626023', // BUGALLO OTERO Araceli
  'ffce67fb-ad7b-4ad7-8a08-65d398ba8afc', // COLLADO RUEDA Sol
  'c3f29ee3-db00-4179-a481-dc3c168890a8', // JAUDENES GUAL DE TORRELLA Valerie
  '07769030-1c8f-4c46-a576-e6505c296b98', // MARIN CASTILLO Dianicely
  'db00e319-6037-459b-ad63-1f7f6334fa04', // ROVIRA SERENA Rosario
  '3f16f475-37f9-45ac-9542-a1cef7cf5009', // SANCHEZ PEDRAZA Cristina
  '56bd8890-ed8f-45d2-970e-fc34b1f52825', // SANTAMARIA PUENTE Mar (su florete M VET es una participación real en prueba masculina)
  '8d72aca2-8c13-4879-a599-e03d995e77ff', // VICANDI EMBEITA Jasone
  'b7d9ea40-295f-402b-8583-ac07c2722c57', // CALDERON MONDRAGON Sara Isabel
  '80ecb97a-3cdf-4866-b83c-31001fd3bd4e', // GARCIA ALCOBENDAS Victoria
  '5d0456fc-15b6-4221-83da-5112f3bc6724', // PEREZ FERNAUD Nieves
  'cde92c11-8842-4d6c-b607-c688cd64dd4c', // STAMPA SAUVAGEOT Cayetana
];

export interface InformeRevisionManual {
  uniones: { origen: string; destino: string; nombreOrigen: string | null; nombreDestino: string | null; estado: string }[];
  separaciones: { persona: string; raiz: string; nombre: string | null; estado: string }[];
  pruebasF: { id: string; clave: string | null; antes: string | null; estado: string }[];
  fichasF: { id: string; nombre: string | null; antes: string | null; estado: string }[];
  pruebasM: { id: string; clave: string | null; antes: string | null; estado: string }[];
  fichasM: { id: string; nombre: string | null; antes: string | null; estado: string }[];
  aplicado: boolean;
}

type Persona = { id: string; n: string; m: string | null; g: string | null };

export function revisionManual(db: DatabaseSync, opciones: { aplicar?: boolean } = {}): InformeRevisionManual {
  const t = ahora();
  const inf: InformeRevisionManual = { uniones: [], separaciones: [], pruebasF: [], fichasF: [], pruebasM: [], fichasM: [], aplicado: false };
  const persona = db.prepare(`SELECT id, display_name n, merged_into_person_id m, gender g FROM sport_person WHERE id = ?`);
  const leer = (id: string) => (persona.get(id) as Persona | undefined) ?? null;
  const raiz = (id: string) => {
    let a = id;
    for (let i = 0; i < 8; i += 1) {
      const m = leer(a)?.m;
      if (!m) return a;
      a = m;
    }
    throw new Error(`cadena_de_fusiones_demasiado_larga:${id}`);
  };
  const escribir = opciones.aplicar === true;
  const fundir = escribir ? db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE id = ? AND merged_into_person_id IS NULL`) : null;
  const reapuntar = escribir ? db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`) : null;
  const candidato = escribir ? db.prepare(
    `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?, '${FUENTE_REVISION}', ?, ?, ?, 'CONFIRMADO', ?, ?, ?)`,
  ) : null;

  for (const u of UNIONES_MANUALES) {
    const o = leer(u.origen);
    const d = leer(u.destino);
    const fila = { origen: u.origen, destino: u.destino, nombreOrigen: o?.n ?? null, nombreDestino: d?.n ?? null, estado: '' };
    inf.uniones.push(fila);
    if (!o || !d) { fila.estado = 'falta_persona'; continue; }
    const r = raiz(u.destino);
    if (raiz(u.origen) === r) { fila.estado = 'ya_unidas'; continue; }
    // Never move a person that another merge already placed elsewhere: that needs a new review.
    if (o.m) { fila.estado = 'origen_fundido_en_otra'; continue; }
    if (o.g && leer(r)?.g && o.g !== leer(r)!.g) { fila.estado = 'genero_distinto'; continue; }
    fila.estado = escribir ? 'unida' : 'se_uniria';
    if (!escribir) continue;
    fundir!.run(r, t, u.origen);
    reapuntar!.run(r, t, u.origen);
    candidato!.run(uuid(), u.origen, o.n, r, `${FUSION_REVISION_MANUAL}:${u.motivo}`, t, t);
  }

  const soltar = escribir ? db.prepare(`UPDATE sport_person SET merged_into_person_id = NULL, updated_at = ? WHERE id = ? AND merged_into_person_id = ?`) : null;
  const anularFusion = escribir ? db.prepare(
    `UPDATE sport_link_candidate SET status = 'RECHAZADO', evidence = ?, decided_at = ? WHERE source_ref = ? AND person_id = ? AND status = 'CONFIRMADO'`,
  ) : null;
  const anotarSeparacion = escribir ? db.prepare(
    `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?, '${FUENTE_REVISION}', ?, ?, ?, 'RECHAZADO', ?, ?, ?)`,
  ) : null;
  for (const s of SEPARACIONES_MANUALES) {
    const p = leer(s.persona);
    const fila = { persona: s.persona, raiz: s.raiz, nombre: p?.n ?? null, estado: '' };
    inf.separaciones.push(fila);
    if (!p) { fila.estado = 'falta_persona'; continue; }
    if (p.m !== s.raiz) { fila.estado = p.m ? 'fundida_en_otra' : 'ya_separada'; continue; }
    fila.estado = escribir ? 'separada' : 'se_separaria';
    if (!escribir) continue;
    const evidencia = `${FUSION_REVISION_MANUAL}:separada:${s.motivo}`;
    soltar!.run(t, s.persona, s.raiz);
    anularFusion!.run(evidencia, t, s.persona, s.raiz);
    anotarSeparacion!.run(uuid(), s.persona, p.n, s.raiz, evidencia, t, t);
  }

  const prueba = db.prepare(`SELECT competition_key k, gender g FROM sport_competition WHERE id = ?`);
  const generoPrueba = escribir ? db.prepare(`UPDATE sport_competition SET gender = 'F', updated_at = ? WHERE id = ? AND gender = 'M'`) : null;
  for (const id of PRUEBAS_FEMENINAS) {
    const p = prueba.get(id) as { k: string; g: string } | undefined;
    const estado = !p ? 'falta' : p.g === 'F' ? 'ya_f' : escribir ? 'cambiada' : 'se_cambiaria';
    inf.pruebasF.push({ id, clave: p?.k ?? null, antes: p?.g ?? null, estado });
    if (p?.g === 'M' && escribir) generoPrueba!.run(t, id);
  }
  const generoFicha = escribir ? db.prepare(`UPDATE sport_person SET gender = 'F', updated_at = ? WHERE id = ? AND gender = 'M'`) : null;
  for (const id of FICHAS_FEMENINAS) {
    const p = leer(id);
    const estado = !p ? 'falta' : p.g === 'F' ? 'ya_f' : escribir ? 'cambiada' : 'se_cambiaria';
    inf.fichasF.push({ id, nombre: p?.n ?? null, antes: p?.g ?? null, estado });
    if (p?.g === 'M' && escribir) generoFicha!.run(t, id);
  }

  const generoPruebaM = escribir ? db.prepare(`UPDATE sport_competition SET gender = 'M', updated_at = ? WHERE id = ? AND gender = 'F'`) : null;
  for (const id of PRUEBAS_MASCULINAS) {
    const p = prueba.get(id) as { k: string; g: string } | undefined;
    const estado = !p ? 'falta' : p.g === 'M' ? 'ya_m' : escribir ? 'cambiada' : 'se_cambiaria';
    inf.pruebasM.push({ id, clave: p?.k ?? null, antes: p?.g ?? null, estado });
    if (p?.g === 'F' && escribir) generoPruebaM!.run(t, id);
  }
  // Only records whose every placing is in those events: anyone with another result keeps the gender it has there.
  const lista = PRUEBAS_MASCULINAS.map(() => '?').join(', ');
  const creadasAlli = db.prepare(`SELECT DISTINCT p.id, p.display_name n, p.gender g FROM sport_result r JOIN sport_person p ON p.id = r.person_id
    WHERE r.competition_id IN (${lista}) AND p.gender = 'F'
      AND NOT EXISTS (SELECT 1 FROM sport_result o WHERE o.person_id = p.id AND o.competition_id NOT IN (${lista}))`)
    .all(...PRUEBAS_MASCULINAS, ...PRUEBAS_MASCULINAS) as { id: string; n: string; g: string }[];
  const generoFichaM = escribir ? db.prepare(`UPDATE sport_person SET gender = 'M', updated_at = ? WHERE id = ? AND gender = 'F'`) : null;
  for (const p of creadasAlli) {
    inf.fichasM.push({ id: p.id, nombre: p.n, antes: p.g, estado: escribir ? 'cambiada' : 'se_cambiaria' });
    if (escribir) generoFichaM!.run(t, p.id);
  }
  inf.aplicado = escribir;
  return inf;
}

export function aplicarRevisionManual(db: DatabaseSync): InformeRevisionManual {
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      const inf = revisionManual(db, { aplicar: true });
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) throw new Error(`foreign_key_check: ${fk.length} filas`);
      db.exec('COMMIT');
      return inf;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
  }
}

function main(): void {
  const ruta = argumento('db', '');
  if (!ruta) throw new Error('falta --db <copia.sqlite>');
  const aplicar = bandera('aplicar');
  if (aplicar && BASES_PROTEGIDAS.has(basename(ruta).toLowerCase())) {
    throw new Error(`${basename(ruta)} es una copia exacta de producción: usa una copia de trabajo`);
  }
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'lote11-informes', aplicar ? 'revision-manual-aplicada.json' : 'revision-manual-ensayo.json'));
  const db = new DatabaseSync(ruta, aplicar ? {} : { readOnly: true });
  let inf: InformeRevisionManual;
  try {
    inf = aplicar ? aplicarRevisionManual(db) : revisionManual(db);
  } finally {
    db.close();
  }
  writeFileSync(salida, `${JSON.stringify(inf, null, 2)}\n`);
  const cuenta = (xs: { estado: string }[]) => xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x.estado]: (a[x.estado] ?? 0) + 1 }), {});
  console.log(`Uniones: ${JSON.stringify(cuenta(inf.uniones))}`);
  console.log(`Separaciones: ${JSON.stringify(cuenta(inf.separaciones))}`);
  console.log(`Pruebas a F: ${JSON.stringify(cuenta(inf.pruebasF))}`);
  console.log(`Fichas a F: ${JSON.stringify(cuenta(inf.fichasF))}`);
  console.log(`Pruebas a M: ${JSON.stringify(cuenta(inf.pruebasM))}`);
  console.log(`Fichas a M: ${JSON.stringify(cuenta(inf.fichasM))}`);
  console.log(`Informe: ${salida}${aplicar ? '' : '\n(ensayo: nada guardado; --aplicar para escribir)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
