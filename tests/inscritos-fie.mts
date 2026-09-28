/**
 * Cuenta y comprueba, con la base de datos delante, qué hay guardado de las
 * listas de inscritos de la FIE.
 *
 * No es un test automático (no vive en `*.test.ts` a propósito): es la
 * herramienta con la que se dan los números antes y después de lanzar la
 * ingestión, y —sobre todo— la que DEMUESTRA que no se ha guardado ni una
 * fecha de nacimiento, ni una edad, ni una altura, ni una foto, ni una sola
 * fila de un tirador que no sea español.
 *
 *   npx tsx tests/inscritos-fie.mts            # el informe entero
 *   npx tsx tests/inscritos-fie.mts --oran     # el caso de Orán de punta a punta
 */

import 'dotenv/config';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  athlete,
  competitionRegistration,
  event,
  eventCompetition,
  fieFencer,
} from '../src/db/schema/index.ts';

const soloOran = process.argv.includes('--oran');

function titulo(texto: string) {
  process.stdout.write(`\n== ${texto} ==\n`);
}

async function numeros() {
  titulo('Inscritos guardados, por fuente');
  const porFuente = await db
    .select({
      fuente: competitionRegistration.source,
      filas: sql<number>`count(*)::int`,
      conLicencia: sql<number>`count(${competitionRegistration.sourceLicense})::int`,
      emparejadas: sql<number>`count(${competitionRegistration.athleteId})::int`,
      vivas: sql<number>`count(*) filter (where ${competitionRegistration.withdrawnAt} is null)::int`,
    })
    .from(competitionRegistration)
    .groupBy(competitionRegistration.source)
    .orderBy(competitionRegistration.source);

  let total = 0;
  for (const f of porFuente) {
    total += f.filas;
    console.log(
      `  ${f.fuente.padEnd(16)} ${String(f.filas).padStart(5)} filas · ` +
        `${String(f.conLicencia).padStart(5)} con licencia · ` +
        `${String(f.emparejadas).padStart(4)} emparejadas · ${f.vivas} vivas`,
    );
  }
  console.log(`  ${'TOTAL'.padEnd(16)} ${String(total).padStart(5)} filas`);

  titulo('Pruebas con lista de inscritos, por ámbito');
  const porAmbito = await db
    .select({
      ambito: event.scope,
      pruebas: sql<number>`count(distinct ${eventCompetition.id})::int`,
      conLista: sql<number>`count(distinct ${competitionRegistration.eventCompetitionId})::int`,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .leftJoin(
      competitionRegistration,
      eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
    )
    .groupBy(event.scope)
    .orderBy(event.scope);
  for (const a of porAmbito) {
    console.log(`  ${a.ambito.padEnd(15)} ${a.conLista} de ${a.pruebas} pruebas con lista`);
  }
}

/**
 * LA CONSULTA QUE LO DEMUESTRA.
 *
 * `competition_registration` solo tiene cuatro columnas de dato publicado
 * —nombre, equipo, licencia y club—, así que no hay ningún sitio donde pudiera
 * caber una fecha de nacimiento ni una foto. Lo que sí hay que comprobar, y es
 * lo que se comprueba aquí:
 *
 *  1. que ninguna fila de la FIE lleve nada con forma de URL de imagen,
 *  2. que ninguna lleve nada con forma de fecha de nacimiento suelta,
 *  3. que ninguna sea de un tirador que no sea español,
 *  4. y cuántas están emparejadas, y por qué camino.
 *
 * El punto 3 no se puede comprobar contra un país guardado, porque el país NO
 * se guarda: se comprueba contra la FIE, pidiendo otra vez la lista de una
 * prueba y viendo que lo guardado es exactamente el subconjunto español.
 */
async function pruebaDeQueNoHayDatosDeMenores() {
  titulo('No hay datos de menores ni de extranjeros guardados (FIE)');

  const [fila] = await db
    .select({
      filas: sql<number>`count(*)::int`,
      conFoto: sql<number>`count(*) filter (
        where ${competitionRegistration.sourceAthleteName} ~* 'https?://'
           or coalesce(${competitionRegistration.sourceLicense}, '') ~* 'https?://'
           or coalesce(${competitionRegistration.sourceClub}, '') ~* 'https?://'
           or coalesce(${competitionRegistration.sourceTeam}, '') ~* 'https?://'
      )::int`,
      conFechaNacimiento: sql<number>`count(*) filter (
        where ${competitionRegistration.sourceAthleteName} ~ '\\d{4}-\\d{2}-\\d{2}'
           or coalesce(${competitionRegistration.sourceClub}, '') ~ '\\d{4}-\\d{2}-\\d{2}'
           or coalesce(${competitionRegistration.sourceTeam}, '') ~ '\\d{4}-\\d{2}-\\d{2}'
      )::int`,
      conAlturaOEdad: sql<number>`count(*) filter (
        where coalesce(${competitionRegistration.sourceClub}, '') ~ '^\\s*\\d{1,3}\\s*$'
      )::int`,
      conClub: sql<number>`count(${competitionRegistration.sourceClub})::int`,
      emparejadas: sql<number>`count(${competitionRegistration.athleteId})::int`,
    })
    .from(competitionRegistration)
    .where(eq(competitionRegistration.source, 'fie'));

  console.log(`  filas de la FIE ................... ${fila?.filas ?? 0}`);
  console.log(`  con algo con forma de URL/foto .... ${fila?.conFoto ?? 0}`);
  console.log(`  con algo con forma de fecha ....... ${fila?.conFechaNacimiento ?? 0}`);
  console.log(`  con algo con forma de edad/altura . ${fila?.conAlturaOEdad ?? 0}`);
  console.log(`  con club (la FIE no lo publica) ... ${fila?.conClub ?? 0}`);
  console.log(`  emparejadas con un tirador nuestro  ${fila?.emparejadas ?? 0}`);

  titulo('Contraste contra la FIE: lo guardado es el subconjunto español');
  const pruebas = await db
    .select({
      id: eventCompetition.id,
      sourceUrl: eventCompetition.sourceUrl,
      nombre: event.name,
      arma: eventCompetition.weapon,
      genero: eventCompetition.gender,
      guardadas: sql<number>`count(${competitionRegistration.id})::int`,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .innerJoin(
      competitionRegistration,
      and(
        eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
        eq(competitionRegistration.source, 'fie'),
      ),
    )
    .groupBy(
      eventCompetition.id,
      eventCompetition.sourceUrl,
      event.name,
      eventCompetition.weapon,
      eventCompetition.gender,
    )
    .orderBy(sql`count(${competitionRegistration.id}) desc`)
    .limit(5);

  for (const p of pruebas) {
    const url = p.sourceUrl?.replace(
      /^https:\/\/fie\.org\/competition\/(\d+)\/(\d+)\/entries$/,
      'https://fie.org/api/fie/competition/$1/$2/entries?pageSize=200',
    );
    if (!url?.startsWith('https://fie.org/api/')) {
      console.log(`  ${p.nombre}: sin URL de lista comprobable`);
      continue;
    }
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CalendarioEsgrima/1.0 (+contacto)' },
    });
    const json = (await res.json()) as {
      totalFound: number;
      items: { fencer: { countryCode?: string | null } }[];
    };
    const espanoles = (json.items ?? []).filter((i) => i.fencer?.countryCode === 'ESP').length;
    const marca = espanoles === p.guardadas ? 'OK' : 'DESCUADRA';
    console.log(
      `  ${marca}  ${p.nombre} · ${p.arma} ${p.genero}: ` +
        `la FIE publica ${json.totalFound} (${espanoles} ESP), guardadas ${p.guardadas}`,
    );
  }
}

async function oran() {
  titulo('Orán: sable masculino absoluto, de punta a punta');
  const filas = await db
    .select({
      nombre: competitionRegistration.sourceAthleteName,
      licencia: competitionRegistration.sourceLicense,
      inscritoEl: competitionRegistration.sourceRegisteredAt,
      athleteId: competitionRegistration.athleteId,
      apellido: athlete.lastName,
      evento: event.name,
      arma: eventCompetition.weapon,
      genero: eventCompetition.gender,
      categoria: eventCompetition.category,
      url: competitionRegistration.sourceUrl,
    })
    .from(competitionRegistration)
    .innerJoin(
      eventCompetition,
      eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
    )
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .leftJoin(athlete, eq(competitionRegistration.athleteId, athlete.id))
    .where(
      and(
        eq(competitionRegistration.source, 'fie'),
        sql`${event.name} ilike '%oran%'`,
        eq(eventCompetition.weapon, 'SABLE'),
        eq(eventCompetition.gender, 'M'),
        eq(eventCompetition.category, 'ABS'),
        eq(eventCompetition.format, 'INDIVIDUAL'),
      ),
    )
    .orderBy(competitionRegistration.sourceAthleteName);

  if (filas.length === 0) {
    console.log('  (ninguna fila todavía)');
    return;
  }
  console.log(`  ${filas[0].evento} · ${filas[0].arma} ${filas[0].genero} ${filas[0].categoria}`);
  console.log(`  ${filas[0].url}`);
  for (const f of filas) {
    console.log(
      `   · ${f.nombre.padEnd(34)} licencia=${(f.licencia ?? '—').padEnd(12)} ` +
        `inscrito=${f.inscritoEl ?? '—'}  tirador=${f.apellido ?? '(sin emparejar)'}`,
    );
  }
}

/** Dónde ha quedado cada fila emparejada, que es lo que decide si se ve. */
async function emparejadas() {
  titulo('Filas emparejadas y en qué prueba viven');
  const filas = await db
    .select({
      nombre: competitionRegistration.sourceAthleteName,
      licencia: competitionRegistration.sourceLicense,
      inscritoEl: competitionRegistration.sourceRegisteredAt,
      tirador: athlete.lastName,
      evento: event.name,
      fuenteEvento: event.source,
      absorbido: event.canonicalEventId,
      arma: eventCompetition.weapon,
      genero: eventCompetition.gender,
      categoria: eventCompetition.category,
      formato: eventCompetition.format,
    })
    .from(competitionRegistration)
    .innerJoin(
      eventCompetition,
      eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
    )
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .innerJoin(athlete, eq(competitionRegistration.athleteId, athlete.id))
    .where(eq(competitionRegistration.source, 'fie'))
    .orderBy(competitionRegistration.sourceAthleteName);

  for (const f of filas) {
    /**
     * `se ve` = la fila cuelga de una prueba de un evento que el calendario
     * pinta. Si el evento está absorbido por otro, su ficha no se abre nunca.
     */
    const seVe = f.absorbido === null;
    console.log(
      `  ${seVe ? 'SE VE   ' : 'guardada'} ${f.nombre.padEnd(24)} -> ${f.tirador?.padEnd(20)} ` +
        `${f.arma} ${f.genero} ${f.categoria} ${f.formato.padEnd(10)} | ${f.evento} [${f.fuenteEvento}]`,
    );
  }
}

async function contexto() {
  titulo('Lo que hay para emparejar');
  const [a] = await db
    .select({
      tiradores: sql<number>`count(*)::int`,
      conRfee: sql<number>`count(${athlete.rfeeLicense})::int`,
      conFie: sql<number>`count(${athlete.fieLicense})::int`,
    })
    .from(athlete);
  console.log(
    `  athlete: ${a?.tiradores} tiradores · ${a?.conRfee} con licencia RFEE · ` +
      `${a?.conFie} con licencia FIE`,
  );

  const [f] = await db
    .select({
      fichas: sql<number>`count(*)::int`,
      enlazadas: sql<number>`count(${fieFencer.athleteId})::int`,
      conLicencia: sql<number>`count(${fieFencer.fieLicense})::int`,
    })
    .from(fieFencer);
  console.log(
    `  fie_fencer: ${f?.fichas} fichas · ${f?.enlazadas} con athlete_id confirmado · ` +
      `${f?.conLicencia} con licencia FIE`,
  );

  const enlazadas = await db
    .select({
      fieId: fieFencer.fieId,
      nombre: fieFencer.sourceName,
      licencia: fieFencer.fieLicense,
      via: fieFencer.linkedVia,
      apellido: athlete.lastName,
    })
    .from(fieFencer)
    .innerJoin(athlete, eq(fieFencer.athleteId, athlete.id))
    .where(isNotNull(fieFencer.athleteId));
  for (const e of enlazadas) {
    console.log(
      `   · fie_id=${e.fieId} ${e.nombre} (licencia ${e.licencia ?? '—'}, vía ${e.via}) ` +
        `-> ${e.apellido}`,
    );
  }

  titulo('Pruebas internacionales futuras (las candidatas a tener lista)');
  const hoy = new Date().toISOString().slice(0, 10);
  const [c] = await db
    .select({
      pruebas: sql<number>`count(*)::int`,
      conUrlFie: sql<number>`count(*) filter (where ${eventCompetition.sourceUrl} like 'https://fie.org/competition/%')::int`,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        eq(event.source, 'fie'),
        isNull(event.disappearedAt),
        sql`${event.endDate} >= ${hoy}`,
      ),
    );
  console.log(`  ${c?.pruebas} pruebas FIE futuras · ${c?.conUrlFie} con URL de lista`);
}

if (soloOran) {
  await oran();
} else {
  await numeros();
  await contexto();
  await pruebaDeQueNoHayDatosDeMenores();
  await oran();
  await emparejadas();
}
process.stdout.write('\n');
