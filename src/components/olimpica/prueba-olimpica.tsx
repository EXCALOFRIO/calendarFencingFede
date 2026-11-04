import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { BanderaPais } from '@/components/bandera';
import { Pastilla } from '@/components/sistema/pastilla';
import type {
  EquipoClasificado,
  EstadoNoc,
  MotivoPendiente,
  PrimerFuera,
  ReglasOlimpicas,
  ResultadoPrueba,
} from '@/lib/ranking/olimpica';
import { ZONAS_FIE } from '@/lib/ranking/olimpica';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { MOTIVO_TEXTO, ZONA_CORTA, fechaCorta } from './textos';

const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function viaEquipo(e: EquipoClasificado, R: ReglasOlimpicas): string {
  if (e.via === 'TOP') return `${R.equiposTop} primeros`;
  if (e.plazaDeZona) return e.via === 'ZONA' ? ZONA_CORTA[e.plazaDeZona] : `Plaza de ${ZONA_CORTA[e.plazaDeZona]}`;
  return 'Plaza libre';
}

/**
 * Una fila de la proyección, con la forma de las filas del ranking:
 * posición, bandera, nombre y puntos. El color manda:
 *
 *   `dentro`  verde — esa plaza la tiene hoy (equipo o tirador);
 *   `fuera`   amarillo — la primera que se queda fuera de ese camino,
 *             con lo que le falta («a 14 pts», empate dicho);
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

function Fila({
  posicion,
  noc,
  nombre,
  via,
  puntos,
  estado,
  propio,
}: {
  posicion: string;
  noc: string;
  /** Nombre del tirador; en equipos se enseña el país con `conNombre`. */
  nombre?: string | null;
  /** El camino de la plaza («4 primeros», «Europa», «12.º» en los de fuera). */
  via?: string | null;
  puntos: string;
  estado: 'dentro' | 'fuera' | 'dudoso';
  propio: boolean;
}) {
  const tono = TONOS_FILA[estado];
  return (
    <li
      data-estado={estado}
      data-propio={propio ? '' : undefined}
      className={cn(
        'grid min-w-0 grid-cols-[2.5rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2',
        tono.fila,
        propio && 'bg-marcado font-semibold text-foreground',
      )}
    >
      <span className={cn('truncate text-xs tabular-nums', tono.posicion, propio && 'text-foreground')}>
        {posicion}
      </span>
      <BanderaPais pais={noc} conNombre={!nombre} />
      <span className="min-w-0 truncate text-sm">
        {nombre}
        {via ? (
          <span className="text-xs font-normal text-muted-foreground">
            {nombre ? ` · ${via}` : via}
          </span>
        ) : null}
      </span>
      <span className={cn('cifra text-sm tabular-nums', tono.puntos, propio && 'text-foreground')}>
        {puntos}
      </span>
    </li>
  );
}

/** La fila amarilla: quién hereda el camino si el de arriba cae. */
function FilaFuera({ fuera, rotulo, propio }: { fuera: PrimerFuera; rotulo: string; propio: string }) {
  return (
    <Fila
      posicion={rotulo}
      noc={fuera.noc}
      nombre={fuera.nombre}
      via={fuera.nombre ? `${fuera.posicion}.º` : `${fuera.posicion}.º · siguiente`}
      puntos={fuera.empate ? 'empate' : `a ${numero.format(fuera.diferencia)}`}
      estado="fuera"
      propio={fuera.noc === propio}
    />
  );
}

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
        {descripcion ? <span className="ml-2 normal-case tracking-normal">· {descripcion}</span> : null}
      </h4>
      <ul className="mt-1.5 min-w-0 space-y-px">{children}</ul>
    </section>
  );
}

/**
 * El estado del CON seguido, en dos rótulos —equipo e individual— porque
 * son plazas distintas que se ganan distinto: «Equipo» en verde o «Equipo a
 * 30 pts» en amarillo, «Clasificado» o «Individual a 12 pts». Antes sólo
 * salía el del equipo y el individual quedaba escondido dentro.
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
 * Cada prueba va PLEGADA: de entrada se ve el arma con el género y, junto a
 * la flecha, el estado del CON seguido en dos rótulos (equipo e individual).
 * Abierta, es una clasificación con la forma del ranking —filas de posición,
 * bandera, nombre y puntos— coloreada por lo que significa:
 *
 *   en verde,    quién tiene hoy la plaza (los 4 primeros y el mejor de cada
 *                zona por equipos; los AOR y los mejores de cada zona por
 *                individual — el torneo zonal aún no tiene nombres);
 *   en amarillo, el primero que se queda fuera de cada camino y a cuántos
 *                puntos está.
 *
 * Cifras y umbrales salen de `resultado.reglas`, no escritos a mano: si el
 * sistema cambia de cuota (o la composición del ranking, p. ej. una
 * readmisión), el texto sigue diciendo lo que se calcula. Con `excluidos`
 * dice también quién aparece en el ranking pero no cuenta, y por qué.
 */
export function PruebaOlimpica({
  resultado,
  excluidos,
  nocPropio = 'ESP',
}: {
  resultado: ResultadoPrueba;
  /**
   * CON que salen en el ranking pero no cuentan, con su motivo cuando lo hay
   * (`AnotacionesPrueba.excluidos`). Sin la prop se usan `resultado.excluidos`,
   * que no llevan motivo.
   */
  excluidos?: readonly { noc: string; motivo: MotivoPendiente }[];
  nocPropio?: string;
}) {
  const R = resultado.reglas;
  const fecha = fechaCorta(resultado.fechaRanking);
  const fechaDecisiva = fechaCorta(R.fechaRankingDecisivo);
  const ultimoTop = resultado.equipos.map((e) => e.via).lastIndexOf('TOP');

  const totalIndividual =
    resultado.aorMundial.length +
    ZONAS_FIE.reduce((n, z) => n + resultado.aorZona[z].length, 0) +
    resultado.plazasTorneoZonal;

  // Los que aparecen en el ranking pero no cuentan, con su motivo cuando lo
  // hay: salen como filas grises al final («RUS · Participación sin decidir»).
  const lista = excluidos?.length
    ? excluidos
    : resultado.excluidos.map((noc) => ({ noc, motivo: undefined }));

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

        {resultado.equipos.length > 0 ? (
          <Seccion
            titulo={`Por equipos · ${resultado.equipos.length}`}
            descripcion={`los ${R.equiposTop} primeros y el mejor de cada zona entre el ${R.tramoZonaEquipos.desde}.º y el ${R.tramoZonaEquipos.hasta}.º`}
          >
            {resultado.equipos.map((e, i) => {
              const fuera =
                e.via === 'TOP'
                  ? i === ultimoTop
                    ? resultado.primerFuera.equiposTop
                    : null
                  : e.plazaDeZona
                    ? resultado.primerFuera.equiposZona[e.plazaDeZona]
                    : null;
              return (
                <Fragment key={e.noc}>
                  <Fila
                    posicion={`${e.posicion}.º`}
                    noc={e.noc}
                    via={viaEquipo(e, R)}
                    puntos={numero.format(e.puntos)}
                    estado="dentro"
                    propio={e.noc === nocPropio}
                  />
                  {fuera ? (
                    <FilaFuera
                      fuera={fuera}
                      rotulo={e.via === 'TOP' ? '1.º fuera' : `${ZONA_CORTA[e.plazaDeZona!]} fuera`}
                      propio={nocPropio}
                    />
                  ) : null}
                </Fragment>
              );
            })}
            {!resultado.anfitrion.conEquipo ? (
              <li data-anfitrion="" className="px-2 py-1.5 text-xs text-muted-foreground">
                Anfitrión: <BanderaPais pais={resultado.anfitrion.noc} soloBandera /> {resultado.anfitrion.noc} sin equipo hoy.
              </li>
            ) : null}
          </Seccion>
        ) : null}

        {totalIndividual > 0 ? (
          <Seccion
            titulo={`Plazas individuales · ${totalIndividual}`}
            descripcion={`los ${R.plazasAorMundial} primeros, el mejor de cada zona y ${resultado.plazasTorneoZonal} del torneo zonal`}
          >
            {resultado.aorMundial.map((t, i) => (
              <Fragment key={t.fieId}>
                <Fila
                  posicion={`${t.posicion}.º`}
                  noc={t.noc}
                  nombre={t.nombre}
                  via={`${R.plazasAorMundial} primeros`}
                  puntos={numero.format(t.puntos)}
                  estado="dentro"
                  propio={t.noc === nocPropio}
                />
                {i === resultado.aorMundial.length - 1 && resultado.primerFuera.aorMundial ? (
                  <FilaFuera fuera={resultado.primerFuera.aorMundial} rotulo="1.º fuera" propio={nocPropio} />
                ) : null}
              </Fragment>
            ))}
            {ZONAS_FIE.flatMap((zona) =>
              resultado.aorZona[zona].map((t, i, lista) => (
                <Fragment key={`${zona}-${t.fieId}`}>
                  <Fila
                    posicion={`${t.posicion}.º`}
                    noc={t.noc}
                    nombre={t.nombre}
                    via={ZONA_CORTA[zona]}
                    puntos={numero.format(t.puntos)}
                    estado="dentro"
                    propio={t.noc === nocPropio}
                  />
                  {i === lista.length - 1 && resultado.primerFuera.aorZona[zona] ? (
                    <FilaFuera fuera={resultado.primerFuera.aorZona[zona]} rotulo={`${ZONA_CORTA[zona]} fuera`} propio={nocPropio} />
                  ) : null}
                </Fragment>
              )),
            )}
            <li data-zonales="" className="px-2 py-1.5 text-xs text-muted-foreground">
              Torneo zonal · abr 2028: {resultado.plazasTorneoZonal}{' '}
              {resultado.plazasTorneoZonal === 1 ? 'plaza' : 'plazas'} por decidir.
            </li>
            <li className="px-2 pb-1 text-xs text-muted-foreground">
              {`Y los ${R.tiradoresPorEquipo} tiradores de cada equipo clasificado (${resultado.equipos.length * R.tiradoresPorEquipo} más).`}
            </li>
          </Seccion>
        ) : null}

        {lista.length > 0 ? (
          <Seccion titulo="Sin contar" descripcion="aparecen en el ranking pero hoy no cuentan">
            {lista.map((e) => (
              <Fila
                key={e.noc}
                posicion="—"
                noc={e.noc}
                via={e.motivo ? MOTIVO_TEXTO[e.motivo] : 'no cuenta hoy'}
                puntos="no cuenta"
                estado="dudoso"
                propio={false}
              />
            ))}
          </Seccion>
        ) : null}
      </div>
    </section>
  );
}
