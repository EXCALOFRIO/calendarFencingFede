/**
 * Clasificación por equipos de las pruebas FIE por equipos que la base tiene sin ningún
 * puesto (la API de la FIE devuelve `totalFound: 0`), leída de Ophardt Online
 * (fencing.ophardt.online), que conserva los campeonatos continentales, mundiales
 * júnior-cadete, Universiadas, Juegos regionales… desde 2006 aproximadamente.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-fie-equipos.ts [--db <nuevo7.sqlite>] [--sin-red]
 *
 * Mismo modelo que las pruebas FIE por equipos ya cargadas desde Ophardt
 * (`fie-huecos-ophardt.ts`): claves de edición y prueba de la fila FIE existente,
 * puestos `team:ophardt:<nación>`, sin asaltos (Ophardt no los publica).
 *
 * Emparejamiento (nunca por parecido de nombres de equipo):
 *  - un torneo de Ophardt es candidato si empieza dentro de la ventana de fechas de la
 *    edición FIE y su título nombra el mismo campeonato (patrón por tipo de evento);
 *    en Copas del Mundo, además, la nación organizadora debe ser la de la edición;
 *  - la prueba casa con la única sección del candidato con su arma, género, categoría y
 *    modalidad que publica equipos; con varias, sólo si una es del país de la edición;
 *  - se descarta lo ambiguo y se anota el motivo en el informe.
 */
import { pathToFileURL } from 'node:url';
import { argumento, bandera } from './comun';
import { construirHechos, esMarcadorFie, fechaDe, resultadosEquipos, type Objetivo } from './fie-huecos-objetivos';
import { parsearListado, parsearResultados, urlResultados, type SeccionOphardt, type TorneoOphardt } from './fie-huecos-ophardt';
import { abrirNuevo7, dia, EscritorHechos, fechaDeDia, NUEVO7 } from './lote7-faltan-comun';
import { Red } from './lote7-faltan-red';

const BASE = 'https://fencing.ophardt.online';

export function objetivosEquipos(db: ReturnType<typeof abrirNuevo7>, hoy: string): Objetivo[] {
  const filas = db.prepare(`
    SELECT c.id, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
           c.competition_date, c.source_url, e.tournament_key, e.name, e.start_date, e.end_date, e.city, e.country_code
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.format = 'EQUIPOS'
       AND coalesce(c.competition_date, e.start_date) < ?
       AND NOT EXISTS (SELECT 1 FROM sport_result r WHERE r.competition_id = c.id)
     ORDER BY c.season, e.name, c.competition_key`).all(hoy) as Record<string, string | null>[];
  return filas.map((f) => ({
    id: f.id!, season: f.season!, competitionKey: f.competition_key!,
    weapon: f.weapon as Objetivo['weapon'], gender: f.gender as Objetivo['gender'], category: f.category as Objetivo['category'],
    categoryRaw: f.category_raw, format: f.format as Objetivo['format'], date: f.competition_date,
    tournamentKey: f.tournament_key!, editionName: f.name!, startDate: f.start_date, endDate: f.end_date,
    city: f.city, countryCode: f.country_code, sourceUrl: f.source_url,
  }));
}

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export type TipoEvento = { tipo: string; titulo: RegExp; mismaNacion: boolean; margen: number };

/**
 * Tipo de evento por el nombre de la edición FIE y patrón del título en Ophardt.
 * `null`: no hay correspondencia posible (pruebas de ranking de 2008, Mundial de 1956,
 * JOJ 2018 mixto por continentes repartido en seis pruebas).
 */
export function tipoEvento(nombreEdicion: string, ciudad: string | null): TipoEvento | null {
  const n = plano(nombreEdicion);
  const c = plano(ciudad ?? '');
  if (/ranking fie/.test(c) || /joj/.test(n)) return null;
  if (/^(em|ef|fm|ff|sm|sf|me|ms|wf|ws|mf|we)-(eq|team)$/.test(n)) {
    return /pekin|beijing/.test(c) ? { tipo: 'Juegos Olímpicos', titulo: /Olympic/i, mismaNacion: false, margen: 5 } : null;
  }
  if (/test event/.test(n)) return { tipo: 'Evento de prueba', titulo: /Test/i, mismaNacion: true, margen: 5 };
  if (/coupe du monde|world cup/.test(n)) return { tipo: 'Copa del Mundo', titulo: /World Cup|Coupe du Monde/i, mismaNacion: true, margen: 5 };
  if (/jeux europeens|european games/.test(n)) return { tipo: 'Juegos Europeos', titulo: /European Games/i, mismaNacion: false, margen: 10 };
  if (/europe/.test(n)) return { tipo: 'Europeos', titulo: /Europ\w* Championship|Championnats? d.Europe/i, mismaNacion: false, margen: 45 };
  if (/universiade|fisu/.test(n)) return { tipo: 'Universiada', titulo: /Universi|FISU/i, mismaNacion: false, margen: 20 };
  if (/jeux asiatiques|asian games/.test(n)) return { tipo: 'Juegos Asiáticos', titulo: /Asian Games/i, mismaNacion: false, margen: 20 };
  if (/asiati|asian/.test(n)) return { tipo: 'Asiáticos', titulo: /Asia/i, mismaNacion: false, margen: 45 };
  if (/jeux panamericains|pan american games/.test(n)) return { tipo: 'Juegos Panamericanos', titulo: /Pan.?Am\w* Games/i, mismaNacion: false, margen: 20 };
  if (/panameric/.test(n)) return { tipo: 'Panamericanos', titulo: /Pan.?Americ\w* Championship/i, mismaNacion: false, margen: 45 };
  if (/afrique|africa/.test(n)) return { tipo: 'Africanos', titulo: /Afri/i, mismaNacion: false, margen: 45 };
  if (/commonwealth/.test(n)) return { tipo: 'Commonwealth', titulo: /Commonwealth/i, mismaNacion: false, margen: 20 };
  if (/mediterran/.test(n)) return { tipo: 'Mediterráneos', titulo: /Mediterr/i, mismaNacion: false, margen: 20 };
  if (/centram|centroam|caraib|caribe/.test(n)) return { tipo: 'Centroamericanos', titulo: /Central Americ|Centroameric|Caribbean|Caribe|CAC/i, mismaNacion: false, margen: 20 };
  if (/sudameric|suramer/.test(n)) return { tipo: 'Sudamericanos', titulo: /South Americ|Sudameric|Suramer|ODESUR/i, mismaNacion: false, margen: 20 };
  if (/arabophone|arab/.test(n)) return { tipo: 'Juegos Árabes', titulo: /Arab/i, mismaNacion: false, margen: 20 };
  if (/monde|world/.test(n)) return { tipo: 'Mundiales', titulo: /World Championships?|Championnats? du monde/i, mismaNacion: false, margen: 30 };
  return null;
}

export type Instancia = { clave: string; tipo: TipoEvento; objetivos: Objetivo[]; desde: string; hasta: string };

export function instanciasEquipos(objetivos: readonly Objetivo[]): { instancias: Instancia[]; sinTipo: Objetivo[]; marcadores: Objetivo[] } {
  const grupos = new Map<string, Objetivo[]>();
  const sinTipo: Objetivo[] = [];
  const marcadores: Objetivo[] = [];
  for (const o of objetivos) {
    if (esMarcadorFie(o)) {
      marcadores.push(o);
      continue;
    }
    if (!tipoEvento(o.editionName, o.city)) {
      sinTipo.push(o);
      continue;
    }
    const k = `${o.editionName.trim()}|${o.season}|${o.city ?? ''}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(o);
  }
  const instancias = [...grupos].map(([clave, os]) => {
    const tipo = tipoEvento(os[0].editionName, os[0].city)!;
    const fechas = os.map(fechaDe).sort();
    return {
      clave, tipo, objetivos: os,
      desde: fechaDeDia(dia(fechas[0]) - tipo.margen),
      hasta: fechaDeDia(dia(fechas[fechas.length - 1]) + Math.min(tipo.margen, 10)),
    };
  });
  return { instancias, sinTipo, marcadores };
}

export function candidatos(inst: Instancia, torneos: readonly TorneoOphardt[]): TorneoOphardt[] {
  const pais = inst.objetivos[0].countryCode;
  return torneos.filter((t) => inst.tipo.titulo.test(t.titulo) && !/veteran/i.test(t.titulo) && (!inst.tipo.mismaNacion || t.nacion === pais));
}

type Candidato = { torneo: TorneoOphardt; secciones: SeccionOphardt[]; url: string; sha256: string };

export type Asignacion = { ok: true; candidato: Candidato; seccion: SeccionOphardt } | { ok: false; motivo: string };

export function asignar(o: Objetivo, cands: readonly Candidato[]): Asignacion {
  const casan = cands.flatMap((c) =>
    c.secciones
      .filter((s) => s.weapon === o.weapon && s.gender === o.gender && s.category === o.category && s.format === 'EQUIPOS' && s.equipos.length >= 2)
      .map((s) => ({ c, s })));
  if (casan.length === 0) return { ok: false, motivo: cands.length ? 'ninguna_seccion_casa' : 'sin_torneo_ophardt' };
  if (casan.length === 1) return { ok: true, candidato: casan[0].c, seccion: casan[0].s };
  const mismoPais = casan.filter((x) => x.c.torneo.nacion === o.countryCode);
  if (mismoPais.length === 1) return { ok: true, candidato: mismoPais[0].c, seccion: mismoPais[0].s };
  return { ok: false, motivo: `ambigua:${[...new Set(casan.map((x) => x.c.torneo.id))].join(',')}` };
}

async function listado(red: Red, desde: string, hasta: string): Promise<TorneoOphardt[]> {
  const todos: TorneoOphardt[] = [];
  for (let p = 1, max = 1; p <= max && p <= 30; p += 1) {
    const url = `${BASE}/en/search/results?date-from=${desde}&date-to=${hasta}${p > 1 ? `&page=${p}` : ''}`;
    const r = await red.get(url);
    if (r.status !== 200) break;
    const l = parsearListado(r.body.toString('utf8'));
    todos.push(...l.torneos);
    max = l.paginas;
  }
  return todos;
}

async function main(): Promise<void> {
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const hoy = new Date().toISOString().slice(0, 10);
  const objetivos = objetivosEquipos(db, hoy);
  db.close();
  const { instancias, sinTipo, marcadores } = instanciasEquipos(objetivos);
  const red = new Red();
  const escritor = new EscritorHechos('ophardt_resultados');
  const informe: Record<string, unknown>[] = [];
  const porTipo: Record<string, { objetivos: number; escritos: number }> = {};
  let equipos = 0;
  for (const inst of instancias) {
    const t = (porTipo[inst.tipo.tipo] ??= { objetivos: 0, escritos: 0 });
    t.objetivos += inst.objetivos.length;
    const torneos = await listado(red, inst.desde, inst.hasta);
    const cands: Candidato[] = [];
    for (const tor of candidatos(inst, torneos)) {
      const r = await red.get(urlResultados(tor.id));
      if (r.status !== 200) continue;
      cands.push({ torneo: tor, secciones: parsearResultados(r.body.toString('utf8')), url: urlResultados(tor.id), sha256: r.sha256 });
    }
    console.log(`${inst.clave}: ${torneos.length} torneos en ${inst.desde}..${inst.hasta}; candidatos ${cands.map((c) => `${c.torneo.id} «${c.torneo.titulo}» ${c.torneo.nacion}`).join(' / ') || '-'}`);
    for (const o of inst.objetivos) {
      const a = asignar(o, cands);
      if (!a.ok) {
        informe.push({ tipo: inst.tipo.tipo, edicion: o.editionName, season: o.season, competitionKey: o.competitionKey, fecha: fechaDe(o), motivo: a.motivo });
        continue;
      }
      const results = resultadosEquipos(a.seccion.equipos, 'ophardt');
      const ultimo = Math.max(0, ...results.map((r) => r.position ?? 0));
      const completo = ultimo <= results.length;
      const notas = [
        `Clasificación por equipos publicada en Ophardt Online, torneo ${a.candidato.torneo.id} «${a.candidato.torneo.titulo}» (${a.candidato.torneo.nacion} ${a.candidato.torneo.ciudad}, ${a.candidato.torneo.desde}), sección «${a.seccion.titulo}»; la FIE no publica la clasificación de esta prueba`,
        'Prueba por equipos: factKey team:ophardt:<nación>; sin persona. Ophardt no publica los encuentros',
      ];
      if (a.seccion.equiposDeducidos) notas.push('Ophardt sólo lista a los integrantes con el puesto del equipo: un equipo por nación y puesto, con el código de la nación como nombre');
      if (!completo) notas.push(`Clasificación incompleta: último puesto ${ultimo} con ${results.length} filas publicadas`);
      const h = construirHechos(o, {
        extractor: 'ophardt_resultados', sourceUrl: a.candidato.url, sourceSha256: a.candidato.sha256, results, bouts: [],
        status: { results: completo ? 'completo' : 'parcial', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: results.length, notes: notas },
      });
      escritor.escribir(h);
      t.escritos += 1;
      equipos += results.length;
      informe.push({
        tipo: inst.tipo.tipo, edicion: o.editionName, season: o.season, competitionKey: o.competitionKey, fecha: fechaDe(o),
        torneo: a.candidato.torneo.id, fechaTorneo: a.candidato.torneo.desde, titulo: a.candidato.torneo.titulo,
        seccion: a.seccion.titulo, equipos: results.length, estado: h.status.results,
      });
    }
  }
  const borrados = bandera('sin-limpiar') ? 0 : escritor.limpiarAntiguos();
  const resumen = {
    generado: new Date().toISOString(), objetivos: objetivos.length, instancias: instancias.length, ficheros: escritor.total, equipos,
    borradosAntiguos: borrados, porTipo,
    sinCorrespondencia: sinTipo.map((o) => ({ edicion: o.editionName, ciudad: o.city, season: o.season, competitionKey: o.competitionKey })),
    marcadoresTemporadaSiguiente: marcadores.map((o) => ({ edicion: o.editionName, season: o.season, competitionKey: o.competitionKey })),
    peticiones: red.peticiones,
    detalle: informe,
  };
  escritor.informe('fie-equipos', resumen);
  console.log(JSON.stringify({ ...resumen, detalle: undefined, sinCorrespondencia: sinTipo.length, marcadoresTemporadaSiguiente: marcadores.length }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
