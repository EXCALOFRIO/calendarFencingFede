import { Check } from 'lucide-react';
import { BanderaPais } from '@/components/bandera';
import { Pastilla } from '@/components/sistema/pastilla';
import type {
  EquipoClasificado,
  EstadoNoc,
  PrimerFuera,
  ResultadoPrueba,
  TiradorClasificado,
  ZonaFie,
} from '@/lib/ranking/olimpica';
import { ZONAS_FIE } from '@/lib/ranking/olimpica';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { ZONA_CORTA, fechaCorta } from './textos';

const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function viaEquipo(e: EquipoClasificado): string {
  if (e.via === 'TOP') return '4 primeros';
  if (e.via === 'ZONA' && e.plazaDeZona) return ZONA_CORTA[e.plazaDeZona];
  return 'Siguiente';
}

function Seccion({
  titulo,
  cifra,
  children,
}: {
  titulo: string;
  cifra: number;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-border pt-3">
      <h4 className="flex items-baseline gap-2">
        <span className="cifra text-3xl leading-none">{cifra}</span>
        <span className="text-xs text-muted-foreground">{titulo}</span>
      </h4>
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

function Siguiente({ fuera, propio }: { fuera: PrimerFuera; propio: string }) {
  return (
    <span
      data-propio={fuera.noc === propio ? '' : undefined}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1',
        fuera.noc === propio && 'font-semibold text-foreground',
      )}
    >
      <span>Sig.</span>
      <BanderaPais pais={fuera.noc} soloBandera />
      <span className="min-w-0 truncate">{fuera.nombre ?? fuera.noc}</span>
      <span className="shrink-0 tabular-nums">
        {fuera.empate ? 'empate' : `a ${numero.format(fuera.diferencia)}`}
      </span>
    </span>
  );
}

function EstadoPropio({ estado }: { estado: EstadoNoc | undefined }) {
  if (!estado) return null;
  const dentro = estado.tiradores > 0;
  if (dentro) {
    return (
      <Pastilla tono="ok" tamano="md" data-estado-propio="dentro">
        <BanderaPais pais={estado.noc} soloBandera />
        <Check aria-hidden />
        {estado.equipo ? 'Equipo' : `${estado.tiradores} plaza`}
      </Pastilla>
    );
  }
  const distancia = estado.distanciaEquipo ?? estado.distanciaIndividual;
  if (!distancia) return null;
  return (
    <Pastilla tamano="md" data-estado-propio="fuera">
      <BanderaPais pais={estado.noc} soloBandera />
      {`a ${numero.format(distancia.diferencia)} pts`}
    </Pastilla>
  );
}

/**
 * Una prueba olímpica: equipos dentro, plazas individuales y el primero que
 * se queda fuera de cada camino. Sin estado: se puede pintar en el servidor.
 */
export function PruebaOlimpica({
  resultado,
  nocPropio = 'ESP',
}: {
  resultado: ResultadoPrueba;
  nocPropio?: string;
}) {
  const fecha = fechaCorta(resultado.fechaRanking);
  const fueraEquipos = resultado.primerFuera.equipos;
  const individualesZona = ZONAS_FIE.map((z) => [z, resultado.aorZona[z]] as const).filter(
    (par): par is readonly [ZonaFie, TiradorClasificado] => par[1] !== null,
  );
  const totalIndividual =
    resultado.aorMundial.length + individualesZona.length + resultado.plazasTorneoZonal;

  return (
    <article
      className="min-w-0 space-y-3"
      data-prueba={`${resultado.arma}-${resultado.genero}`}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="mr-auto text-lg leading-tight">
          {rotuloPrueba({ arma: resultado.arma, genero: resultado.genero })}
        </h3>
        <EstadoPropio estado={resultado.seguidos[nocPropio]} />
        <Pastilla tamano="md" data-provisional="">
          Provisional
          {fecha ? <time dateTime={resultado.fechaRanking ?? undefined}>{fecha}</time> : null}
        </Pastilla>
      </header>

      {resultado.equipos.length > 0 ? (
        <Seccion titulo="Equipos" cifra={resultado.equipos.length}>
          {resultado.equipos.map((e) => (
            <Fila
              key={e.noc}
              rotulo={viaEquipo(e)}
              noc={e.noc}
              nombre={`${e.posicion}.º`}
              puntos={e.puntos}
              propio={e.noc === nocPropio}
            />
          ))}
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
                {fueraEquipos.empate ? 'empate' : `−${numero.format(fueraEquipos.diferencia)}`}
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
              <span />
            </li>
          ) : null}
        </Seccion>
      ) : null}

      {totalIndividual > 0 ? (
        <Seccion titulo="Individual" cifra={totalIndividual}>
          {resultado.aorMundial.map((t, i) => (
            <Fila
              key={t.fieId}
              rotulo="2 primeros"
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
          {individualesZona.map(([zona, t]) => {
            const fuera = resultado.primerFuera.aorZona[zona];
            return (
              <Fila
                key={zona}
                rotulo={ZONA_CORTA[zona]}
                noc={t.noc}
                nombre={t.nombre}
                puntos={t.puntos}
                propio={t.noc === nocPropio}
                segunda={fuera ? <Siguiente fuera={fuera} propio={nocPropio} /> : null}
              />
            );
          })}
          <li
            data-zonales=""
            className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-muted-foreground"
          >
            <span className="text-xs">Zonal</span>
            <span className="min-w-0 truncate text-xs">abr 2028</span>
            <span className="cifra text-sm tabular-nums">{resultado.plazasTorneoZonal}</span>
          </li>
        </Seccion>
      ) : null}
    </article>
  );
}
