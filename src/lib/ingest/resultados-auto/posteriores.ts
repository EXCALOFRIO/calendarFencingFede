/**
 * Lo que se actualiza DESPUÉS de escribir una prueba, para las personas que ha tocado:
 *
 *  - `perfil_deportista` (0007): fila mínima para cada persona nueva (ID FIE, año de nacimiento
 *    publicado por Skermo, club) y club más reciente de las demás cuando el nuevo puesto es
 *    posterior al que tenían. El resto del perfil (nombre completo, mano, altura) lo sigue
 *    construyendo el lote (`aplicar-perfiles.ts`); el año de un posible menor sólo se copia,
 *    nunca la fecha, como allí.
 *  - índice de Explorar (0004): `peso` de las personas ya indexadas. Las personas y alias nuevos
 *    quedan por encima de las marcas de `explorar_indice_estado` y la búsqueda los encuentra en
 *    vivo, así que no hace falta reconstruir el índice.
 *  - eventos (`resultado_auto_evento`) para las notificaciones: ver `eventos.ts`.
 *
 * Nada de esto toca sport_*: no consume libro de capacidad.
 */
import type { HechosPrueba } from '../hechos/formato';
import type { PlanCarga } from './cargar';
import type { Sentencia } from './sql';

type SinFilas = Omit<Sentencia, 'filas'>;

/** Mismo peso que `PESO_RESULTADO_SQL` (índice de Explorar) para un puesto de este año. */
export function pesoResultado(fecha: string | null, hoy: string): number {
  if (!fecha || fecha > sumarMeses(hoy, 1)) return 1;
  if (fecha >= sumarMeses(hoy, -12)) return 4;
  if (fecha >= sumarMeses(hoy, -36)) return 3;
  if (fecha >= sumarMeses(hoy, -72)) return 2;
  return 1;
}

function sumarMeses(dia: string, meses: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

export function sentenciasPerfil(h: HechosPrueba, plan: PlanCarga, ahora: number): SinFilas[] {
  const fecha = h.competition.date ?? h.edition.startDate;
  const nuevas = new Set(plan.personasNuevas);
  const porClave = new Map(h.results.map((r) => [r.factKey, r]));
  const out: SinFilas[] = [];
  const vistos = new Set<string>();
  for (const p of plan.puestos) {
    if (!p.personId || vistos.has(p.personId)) continue;
    vistos.add(p.personId);
    const r = porClave.get(p.factKey);
    if (!r) continue;
    const club = r.club?.trim() || null;
    if (nuevas.has(p.personId)) {
      out.push({
        sql: `insert into perfil_deportista (person_id, birth_year, birth_source, club_code, club_source, club_seen_on, fie_id, updated_at)
          values (?,?,?,?,?,?,?,?) on conflict (person_id) do nothing`,
        params: [p.personId, r.birthYear ?? null, r.birthYear ? 'skermo_clasificacion' : null, club, club ? h.source : null,
          club ? fecha : null, r.fieId ? Number(r.fieId) : null, ahora],
      });
      continue;
    }
    if (!club || !fecha) continue;
    out.push({
      sql: `update perfil_deportista set club_code=?, club_name=null, club_source=?, club_seen_on=?, updated_at=?
        where person_id=? and coalesce(club_source,'') <> 'fie_biografia'
          and (club_seen_on is null or club_seen_on < ?) and coalesce(club_code,'') <> ?`,
      params: [club, h.source, fecha, ahora, p.personId, fecha, club],
    });
  }
  return out;
}

export function sentenciasIndiceExplorar(h: HechosPrueba, plan: PlanCarga, hoy: string): SinFilas[] {
  const peso = pesoResultado(h.competition.date ?? h.edition.startDate, hoy);
  const nuevas = new Set(plan.personasNuevas);
  const ids = [...new Set(plan.puestos.filter((p) => p.personId && !nuevas.has(p.personId)).map((p) => p.personId!))];
  const out: SinFilas[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const t = ids.slice(i, i + 90);
    out.push({ sql: `update explorar_persona set peso = peso + ? where id in (${t.map(() => '?').join(',')})`, params: [peso, ...t] });
  }
  return out;
}

export function sentenciasEventos(h: HechosPrueba, plan: PlanCarga, ahora: number, nombre: string): SinFilas[] {
  const out: SinFilas[] = [];
  const base = {
    source: h.source, season: h.edition.season, competitionKey: plan.competitionKey, nombre: nombre.slice(0, 160),
    fecha: h.competition.date ?? h.edition.startDate, arma: h.competition.weapon, genero: h.competition.gender,
    categoria: h.competition.category, formato: h.competition.format,
  };
  const evento = (tipo: string, personId: string | null, posicion: number | null, datos: Record<string, unknown>) => out.push({
    sql: `insert into resultado_auto_evento (tipo, competition_id, person_id, posicion, datos, creado_en) values (?,?,?,?,?,?)
      on conflict do nothing`,
    params: [tipo, plan.competitionId, personId, posicion, JSON.stringify(datos).slice(0, 2000), ahora],
  });
  if (plan.previas.results === 0 && plan.filasFinales.results > 0) {
    evento('prueba_publicada', null, null, { ...base, puestos: plan.filasFinales.results });
  }
  const asaltosAntes = plan.previas.pools + plan.previas.tableau;
  const asaltosAhora = plan.filasFinales.pools + plan.filasFinales.tableau;
  if (asaltosAntes === 0 && asaltosAhora > 0) {
    evento('fases_publicadas', null, null, { ...base, poules: plan.filasFinales.pools, cuadro: plan.filasFinales.tableau, fuenteAsaltos: h.source });
  }
  const porClave = new Map(h.results.map((r) => [r.factKey, r]));
  for (const p of plan.puestos) {
    if (!p.personId) continue;
    const r = porClave.get(p.factKey);
    evento('resultado_persona', p.personId, p.position, { ...base, puestoTexto: r?.positionRaw ?? null, nombrePublicado: r?.name ?? null });
  }
  return out;
}
