import { Check, ChevronDown } from 'lucide-react';
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

function Seccion({
  titulo,
  cifra,
  descripcion,
  children,
}: {
  titulo: string;
  cifra: number;
  descripcion?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-border pt-3">
      <h4 className="flex flex-wrap items-baseline gap-x-2">
        <span className="cifra text-3xl leading-none">{cifra}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</span>
      </h4>
      {descripcion ? (
        <div className="mt-1 text-xs text-muted-foreground">{descripcion}</div>
      ) : null}
      <ul className="mt-2 min-w-0 space-y-px">{children}</ul>
    </section>
  );
}

function Fila({
  rotulo,
  noc,
  nombre,
  puntos,
  propio,
  segunda,
}: {
  rotulo: React.ReactNode;
  noc: string;
  nombre?: string | null;
  puntos: number;
  propio: boolean;
  segunda?: React.ReactNode;
}) {
  return (
    <li
      data-propio={propio ? '' : undefined}
      className={cn(
        'min-w-0 rounded-md px-2 py-2',
        propio && 'bg-marcado font-semibold',
      )}
    >
      <div className="grid min-w-0 grid-cols-[4.75rem_auto_minmax(0,1fr)_auto] items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">{rotulo}</span>
        <BanderaPais pais={noc} />
        <span className="min-w-0 truncate text-sm">{nombre ?? ''}</span>
        <span className="cifra text-sm tabular-nums">{numero.format(puntos)}</span>
      </div>
      {segunda ? (
        <div className="mt-1 min-w-0 truncate pl-[5.25rem] text-xs text-muted-foreground">
          {segunda}
        </div>
      ) : null}
    </li>
  );
}

/** «Siguiente: KOR a 25 pts» — quién hereda ese camino si el de arriba cae. */
function Siguiente({ fuera, propio }: { fuera: PrimerFuera; propio: string }) {
  return (
    <span
      data-propio={fuera.noc === propio ? '' : undefined}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1',
        fuera.noc === propio && 'font-semibold text-foreground',
      )}
    >
      <span>Siguiente:</span>
      <BanderaPais pais={fuera.noc} soloBandera />
      <span className="min-w-0 truncate">{fuera.nombre ?? fuera.noc}</span>
      <span className="shrink-0 tabular-nums">
        {fuera.empate ? 'empate' : `a ${numero.format(fuera.diferencia)}`}
      </span>
    </span>
  );
}

/**
 * El estado del CON seguido, en texto y a la vista: «Clasificado»,
 * «Clasificado · equipo», «Equipo a 30 pts» o «A 30 pts». Es la misma frase
 * que lleva la etiqueta junto al nombre en el ranking.
 */
function EstadoPropio({ estado }: { estado: EstadoNoc | undefined }) {
  if (!estado) return null;
  const dentro = estado.tiradores > 0;
  if (dentro) {
    return (
      <Pastilla tono="ok" tamano="md" data-estado-propio="dentro">
        <BanderaPais pais={estado.noc} soloBandera />
        <Check aria-hidden />
        {estado.equipo ? 'Clasificado · equipo' : `Clasificado${estado.tiradores > 1 ? ` · ${estado.tiradores} plazas` : ''}`}
      </Pastilla>
    );
  }
  const distancia = estado.distanciaEquipo ?? estado.distanciaIndividual;
  if (!distancia) return null;
  const deEquipo = distancia.camino.startsWith('EQUIPO');
  return (
    <Pastilla tono="aviso" tamano="md" data-estado-propio="fuera">
      <BanderaPais pais={estado.noc} soloBandera />
      {`${deEquipo ? 'Equipo a' : 'A'} ${numero.format(distancia.diferencia)} pts`}
    </Pastilla>
  );
}

/**
 * ===========================================================================
 * LA SECCIÓN DE CLASIFICACIÓN OLÍMPICA
 * ===========================================================================
 *
 * La sección va PLEGADA: de entrada sólo se ve la fila con el título, el
 * estado del CON propio y la flecha; el desglose se abre al tocarla. El
 * ranking normal es lo primero que se lee — la proyección olímpica se enseña
 * a quien la busca, sin estorbar a quien no.
 *
 * Responde, sin abrir ninguna burbuja y sin saberse el reglamento:
 *
 *   quién entra            las listas de «Por equipos» y «Plazas individuales»,
 *                          separadas porque son plazas distintas que se ganan
 *                          distinto;
 *   quién está cerca       «Siguiente: …» bajo cada camino y el «1.º fuera»;
 *   qué falta              las distancias en puntos («a 25», empates dichos);
 *   y España               el rótulo propio en la cabecera («Clasificado ·
 *                          equipo», «Equipo a 30 pts»…), igual que en el
 *                          ranking.
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
  const fueraEquipos = resultado.primerFuera.equipos;
  const ultimoTop = resultado.equipos.map((e) => e.via).lastIndexOf('TOP');

  const totalIndividual =
    resultado.aorMundial.length +
    ZONAS_FIE.reduce((n, z) => n + resultado.aorZona[z].length, 0) +
    resultado.plazasTorneoZonal;

  // «Sin contar: RUS, BLR (participación sin decidir)», agrupando por motivo.
  const lista = excluidos?.length
    ? excluidos
    : resultado.excluidos.map((noc) => ({ noc, motivo: undefined }));
  const grupos: string[] = [];
  const sinMotivo: string[] = [];
  const porMotivo = new Map<MotivoPendiente, string[]>();
  for (const e of lista) {
    if (e.motivo) porMotivo.set(e.motivo, [...(porMotivo.get(e.motivo) ?? []), e.noc]);
    else sinMotivo.push(e.noc);
  }
  if (sinMotivo.length) grupos.push(sinMotivo.join(', '));
  for (const [m, nocs] of porMotivo) {
    grupos.push(`${nocs.join(', ')} (${MOTIVO_TEXTO[m].toLowerCase()})`);
  }
  const textoExcluidos = grupos.join('; ');

  return (
    <details
      className="sis-details sis-details-grande group min-w-0 max-w-3xl rounded-xl border bg-card"
      data-prueba={`${resultado.arma}-${resultado.genero}`}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="mr-auto min-w-0">
          <h3 className="text-base leading-tight">Clasificación olímpica · LA 2028</h3>
          <div className="truncate text-xs text-muted-foreground">
            {rotuloPrueba({ arma: resultado.arma, genero: resultado.genero })}
          </div>
        </div>
        <EstadoPropio estado={resultado.seguidos[nocPropio]} />
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>

      <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Pastilla tamano="md" data-provisional="">
            Provisional
            {fecha ? <time dateTime={resultado.fechaRanking ?? undefined}>{fecha}</time> : null}
          </Pastilla>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {`Quién entraría si el ranking se cerrara hoy; decide el del ${fechaDecisiva ?? R.fechaRankingDecisivo}.`}
            {textoExcluidos ? ` Sin contar: ${textoExcluidos}.` : ''}
          </span>
        </div>

      {resultado.equipos.length > 0 ? (
        <Seccion
          titulo="Por equipos"
          cifra={resultado.equipos.length}
          descripcion={`Los ${R.equiposTop} primeros y el mejor de cada zona entre el ${R.tramoZonaEquipos.desde}.º y el ${R.tramoZonaEquipos.hasta}.º.`}
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
              <Fila
                key={e.noc}
                rotulo={viaEquipo(e, R)}
                noc={e.noc}
                nombre={`${e.posicion}.º`}
                puntos={e.puntos}
                propio={e.noc === nocPropio}
                segunda={fuera ? <Siguiente fuera={fuera} propio={nocPropio} /> : null}
              />
            );
          })}
          {fueraEquipos ? (
            <li
              data-primer-fuera=""
              data-propio={fueraEquipos.noc === nocPropio ? '' : undefined}
              className={cn(
                'grid min-w-0 grid-cols-[4.75rem_auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-muted-foreground',
                fueraEquipos.noc === nocPropio && 'bg-marcado font-semibold text-foreground',
              )}
            >
              <span className="text-xs">1.º fuera</span>
              <BanderaPais pais={fueraEquipos.noc} />
              <span className="min-w-0 truncate text-sm">{`${fueraEquipos.posicion}.º`}</span>
              <span className="cifra text-sm tabular-nums">
                {fueraEquipos.empate ? 'empate' : `a ${numero.format(fueraEquipos.diferencia)}`}
              </span>
            </li>
          ) : null}
          {!resultado.anfitrion.conEquipo ? (
            <li
              data-anfitrion=""
              className="grid min-w-0 grid-cols-[4.75rem_auto_minmax(0,1fr)] items-center gap-2 px-2 py-2 text-muted-foreground"
            >
              <span className="text-xs">Anfitrión</span>
              <BanderaPais pais={resultado.anfitrion.noc} />
              <span className="min-w-0 truncate text-xs">Sin equipo hoy</span>
            </li>
          ) : null}
        </Seccion>
      ) : null}

      {totalIndividual > 0 ? (
        <Seccion
          titulo="Plazas individuales"
          cifra={totalIndividual}
          descripcion={`Los ${R.plazasAorMundial} primeros, el mejor de cada zona y ${resultado.plazasTorneoZonal} del torneo zonal.`}
        >
          {resultado.aorMundial.map((t, i) => (
            <Fila
              key={t.fieId}
              rotulo={`${R.plazasAorMundial} primeros`}
              noc={t.noc}
              nombre={t.nombre}
              puntos={t.puntos}
              propio={t.noc === nocPropio}
              segunda={
                i === resultado.aorMundial.length - 1 && resultado.primerFuera.aorMundial ? (
                  <Siguiente fuera={resultado.primerFuera.aorMundial} propio={nocPropio} />
                ) : null
              }
            />
          ))}
          {ZONAS_FIE.flatMap((zona) =>
            resultado.aorZona[zona].map((t, i, lista) => (
              <Fila
                key={`${zona}-${t.fieId}`}
                rotulo={ZONA_CORTA[zona]}
                noc={t.noc}
                nombre={t.nombre}
                puntos={t.puntos}
                propio={t.noc === nocPropio}
                segunda={
                  i === lista.length - 1 && resultado.primerFuera.aorZona[zona] ? (
                    <Siguiente fuera={resultado.primerFuera.aorZona[zona]} propio={nocPropio} />
                  ) : null
                }
              />
            )),
          )}
          <li
            data-zonales=""
            className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-muted-foreground"
          >
            <span className="text-xs">Torneo zonal</span>
            <span className="min-w-0 truncate text-xs">abr 2028 · por decidir</span>
            <span className="cifra text-sm tabular-nums">{resultado.plazasTorneoZonal}</span>
          </li>
          <li className="min-w-0 px-2 pb-1 text-xs text-muted-foreground">
            {`Y los ${R.tiradoresPorEquipo} tiradores de cada equipo clasificado (${resultado.equipos.length * R.tiradoresPorEquipo} más).`}
          </li>
        </Seccion>
      ) : null}
      </div>
    </details>
  );
}
