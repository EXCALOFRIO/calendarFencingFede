import { Check } from 'lucide-react';
import { BanderaPais } from '@/components/bandera';
import { Pastilla } from '@/components/sistema/pastilla';
import type { PersonaOlimpica } from '@/lib/queries/olimpica';
import type { EstadoNoc, ResultadoPrueba } from '@/lib/ranking/olimpica';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { MOTIVO_TEXTO, fechaCorta, textoCamino, textoPastilla } from './textos';

const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/**
 * Una fila de la lista, con la forma de las filas del ranking individual:
 * posición, bandera, nombre y puntos. El color manda:
 *
 *   `dentro`  verde — esa plaza la tiene hoy;
 *   `fuera`   amarillo — está cerca: es el reserva de algún camino y la
 *             etiqueta dice lo que le falta («A 14 pts», «Equipo a 30 pts»);
 *   `dudoso`  gris — aparece en el ranking pero hoy no cuenta (la
 *             participación de BLR y RUS está sin decidir).
 *
 * El CON seguido (`propio`) conserva el marcado de siempre encima del color.
 */
const TONOS_FILA = {
  dentro: { fila: 'bg-ok-tinte/50', posicion: 'text-ok', puntos: '' },
  fuera: { fila: 'bg-warn-tinte/60', posicion: 'text-warn', puntos: 'text-warn' },
  dudoso: { fila: 'bg-secondary/50 text-muted-foreground', posicion: 'text-muted-foreground', puntos: '' },
} as const;

const TONO_ESTADO = { clasificado: 'dentro', cerca: 'fuera', pendiente: 'dudoso' } as const;

/** Lo que se lee junto al nombre: el camino cuando entra, lo que falta cuando está cerca, el motivo cuando no cuenta. */
function viaTexto(p: PersonaOlimpica): string {
  const a = p.anotacion;
  if (a.estado === 'clasificado') return textoCamino(a.camino ?? 'AOR', a.zona) ?? 'Clasificado';
  if (a.estado === 'cerca') return textoPastilla(a);
  if (a.estado === 'pendiente') return a.motivo ? MOTIVO_TEXTO[a.motivo] : 'Sin decidir';
  return '';
}

/**
 * El estado del CON seguido, en dos rótulos —equipo e individual— porque
 * son plazas distintas que se ganan distinto: «Equipo» en verde o «Equipo a
 * 30 pts» en amarillo, «Clasificado» o «Individual a 12 pts».
 */
function EstadoPropio({ estado }: { estado: EstadoNoc | undefined }) {
  if (!estado) return null;
  const equipo = estado.equipo ? (
    <Pastilla tono="ok" tamano="sm" data-estado-equipo="dentro">
      <Check aria-hidden />
      Equipo
    </Pastilla>
  ) : estado.distanciaEquipo ? (
    <Pastilla tono="aviso" tamano="sm" data-estado-equipo="fuera">
      {`Equipo a ${numero.format(estado.distanciaEquipo.diferencia)} pts`}
    </Pastilla>
  ) : null;
  const individual = estado.tiradores > 0 ? (
    <Pastilla tono="ok" tamano="sm" data-estado-individual="dentro">
      <Check aria-hidden />
      {`Clasificado${estado.tiradores > 1 ? ` · ${estado.tiradores}` : ''}`}
    </Pastilla>
  ) : estado.distanciaIndividual ? (
    <Pastilla tono="aviso" tamano="sm" data-estado-individual="fuera">
      {`Individual a ${numero.format(estado.distanciaIndividual.diferencia)} pts`}
    </Pastilla>
  ) : null;
  if (!equipo && !individual) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <BanderaPais pais={estado.noc} soloBandera />
      {equipo}
      {individual}
    </span>
  );
}

/**
 * ===========================================================================
 * LA PRUEBA DE CLASIFICACIÓN OLÍMPICA
 * ===========================================================================
 *
 * UNA lista de personas — como el ranking individual, no una tabla de
 * países: a los Juegos van tiradores, y cada fila dice por dónde entra el
 * suyo. Quien clasifica por su selección sale como persona con «Con su
 * equipo»; quien está cerca sale con lo que le falta por el camino MÁS
 * CORTO («Equipo a 30 pts» si le pilla más cerca el equipo que el
 * individual); y al final, en gris, los pendientes que contarían (BLR/RUS).
 *
 * Arriba quedan, como resumen, los dos rótulos del CON seguido: el estado
 * de su equipo y el de sus plazas individuales.
 */
export function PruebaOlimpica({
  resultado,
  personas,
  nocPropio = 'ESP',
}: {
  resultado: ResultadoPrueba;
  /** Las filas ya en orden (ver `PersonaOlimpica`): dentro, cerca, dudosos. */
  personas: PersonaOlimpica[];
  nocPropio?: string;
}) {
  const fecha = fechaCorta(resultado.fechaRanking);
  const fechaDecisiva = fechaCorta(resultado.reglas.fechaRankingDecisivo);
  const R = resultado.reglas;

  return (
    <section
      className="min-w-0 max-w-3xl rounded-xl border bg-card px-3 pb-3 pt-3 sm:px-4 sm:pb-4"
      data-prueba={`${resultado.arma}-${resultado.genero}`}
    >
      <div className="space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 flex-1 text-base leading-tight">
            {rotuloPrueba({ arma: resultado.arma, genero: resultado.genero })}
          </h3>
          <EstadoPropio estado={resultado.seguidos[nocPropio]} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Pastilla tamano="md" data-provisional="">
            Provisional
            {fecha ? <time dateTime={resultado.fechaRanking ?? undefined}>{fecha}</time> : null}
          </Pastilla>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {`Quién entraría si el ranking se cerrara hoy; decide el del ${fechaDecisiva ?? R.fechaRankingDecisivo}.`}
          </span>
        </div>

        {personas.length > 0 ? (
          <ul className="min-w-0 space-y-px">
            {personas.map((p) => {
              const a = p.anotacion;
              const estado = a.estado ?? 'pendiente';
              const tono = TONOS_FILA[TONO_ESTADO[estado]];
              const propio = p.noc === nocPropio;
              const via = viaTexto(p);
              return (
                <li
                  key={p.fieId}
                  data-estado={TONO_ESTADO[estado]}
                  data-propio={propio ? '' : undefined}
                  className={cn(
                    'grid min-w-0 grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2',
                    tono.fila,
                    propio && 'bg-marcado font-semibold text-foreground',
                  )}
                >
                  <span className={cn('text-xs tabular-nums', tono.posicion, propio && 'text-foreground')}>
                    {p.posicion !== null ? `${p.posicion}.º` : '—'}
                  </span>
                  <BanderaPais pais={p.noc} />
                  <span className="line-clamp-2 min-w-0 text-sm leading-tight">
                    {p.nombre}
                    {via ? <span className="text-xs font-normal text-muted-foreground"> · {via}</span> : null}
                  </span>
                  <span className={cn('cifra text-sm tabular-nums', tono.puntos, propio && 'text-foreground')}>
                    {p.puntos !== null ? numero.format(p.puntos) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <ul className="min-w-0 space-y-1 text-xs text-muted-foreground">
          {resultado.plazasTorneoZonal > 0 ? (
            <li data-zonales="">
              {`Torneo zonal · abr 2028: ${resultado.plazasTorneoZonal} ${resultado.plazasTorneoZonal === 1 ? 'plaza' : 'plazas'} por decidir.`}
            </li>
          ) : null}
          {!resultado.anfitrion.conEquipo ? (
            <li data-anfitrion="">
              Anfitrión: <BanderaPais pais={resultado.anfitrion.noc} soloBandera /> {resultado.anfitrion.noc} sin equipo hoy.
            </li>
          ) : null}
          <li>
            {`En verde, quien tiene la plaza hoy — por su equipo o por el ranking individual; en amarillo, quien está cerca con lo que le falta por el camino más corto.`}
          </li>
        </ul>
      </div>
    </section>
  );
}
