import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

/**
 * Fotografía de cobertura de datos de sede, huso y horarios.
 *
 *   npx tsx scripts/diagnostico-sedes.ts
 *
 * Se usa para comparar "antes y después" de tocar los parseadores. No escribe
 * nada: son consultas de solo lectura.
 */
const sql = neon(process.env.DATABASE_URL!);

function tabla(titulo: string, filas: Record<string, unknown>[]): void {
  process.stdout.write(`\n== ${titulo} ==\n`);
  if (filas.length === 0) {
    process.stdout.write('  (sin filas)\n');
    return;
  }
  console.table(filas);
}

const porFuente = await sql`
  select
    source as fuente,
    count(*)::int as eventos,
    count(venue)::int as con_sede,
    count(*) filter (
      where venue is not null
        and city is not null
        and upper(unaccent_es(venue)) <> upper(unaccent_es(city))
    )::int as sede_util,
    count(venue_address)::int as con_direccion,
    count(geo_lat)::int as con_coords,
    count(country)::int as con_pais,
    count(timezone)::int as con_huso,
    count(city)::int as con_ciudad,
    count(official_site)::int as con_web
  from event
  where disappeared_at is null
  group by source
  order by 2 desc
`.catch(async () => {
  // Sin la función auxiliar: versión simple.
  return await sql`
    select
      source as fuente,
      count(*)::int as eventos,
      count(venue)::int as con_sede,
      count(*) filter (where venue is not null and (city is null or lower(venue) <> lower(city)))::int as sede_util,
      count(venue_address)::int as con_direccion,
      count(geo_lat)::int as con_coords,
      count(country)::int as con_pais,
      count(timezone)::int as con_huso,
      count(city)::int as con_ciudad,
      count(official_site)::int as con_web
    from event
    where disappeared_at is null
    group by source
    order by 2 desc
  `;
});
tabla('Eventos vigentes por fuente', porFuente as Record<string, unknown>[]);

const total = await sql`
  select
    count(*)::int as eventos,
    count(venue)::int as con_sede,
    count(venue_address)::int as con_direccion,
    count(geo_lat)::int as con_coords,
    count(country)::int as con_pais,
    count(timezone)::int as con_huso
  from event
  where disappeared_at is null
`;
tabla('Total vigentes', total as Record<string, unknown>[]);

const pruebas = await sql`
  select
    e.source as fuente,
    count(*)::int as pruebas,
    count(c.installation_open)::int as apertura,
    count(c.call_time)::int as llamada,
    count(c.scratch_time)::int as scratch,
    count(c.start_time)::int as inicio,
    count(c.fee_eur)::int as cuota,
    count(c.registration_count)::int as inscritos,
    count(c.competition_date)::int as fecha_prueba
  from event_competition c
  join event e on e.id = c.event_id
  where e.disappeared_at is null
  group by e.source
  order by 2 desc
`;
tabla('Pruebas por fuente', pruebas as Record<string, unknown>[]);

const docs = await sql`
  select e.source as fuente, count(d.*)::int as documentos
  from event e left join event_document d on d.event_id = e.id
  where e.disappeared_at is null
  group by e.source order by 2 desc
`;
tabla('Documentos por fuente', docs as Record<string, unknown>[]);

const enVivo = await sql`
  select e.source as fuente, count(l.*)::int as enlaces
  from event e left join event_live_link l on l.event_id = e.id
  where e.disappeared_at is null
  group by e.source order by 2 desc
`.catch(() => []);
tabla('Enlaces de retransmisión por fuente', enVivo as Record<string, unknown>[]);

const sinPais = await sql`
  select coalesce(country, '(null)') as pais, count(*)::int as eventos,
         count(timezone)::int as con_huso
  from event
  where disappeared_at is null
  group by country
  having count(timezone) < count(*)
  order by 2 desc
`;
tabla('Países sin huso completo', sinPais as Record<string, unknown>[]);

const ranking = await sql`
  select season_label as temporada,
         count(*)::int as filas,
         count(distinct skermo_athlete_id)::int as tiradores,
         count(source_license)::int as filas_con_licencia,
         count(athlete_id)::int as emparejadas,
         count(*) filter (where athlete_id is null)::int as en_cola,
         count(position)::int as clasificados
  from official_ranking_entry
  group by 1
`;
tabla('Ranking oficial de la RFEE', ranking as Record<string, unknown>[]);

const inscritos = await sql`
  select count(*)::int as filas,
         count(distinct event_competition_id)::int as pruebas,
         count(athlete_id)::int as emparejados,
         count(*) filter (where withdrawn_at is not null)::int as retirados
  from competition_registration
`;
tabla('Inscritos publicados por la fuente', inscritos as Record<string, unknown>[]);
