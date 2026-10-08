import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Avatar } from '@/components/sistema/avatar';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { Puesto } from '@/components/sistema/pastilla';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { fechaCorta } from '@/lib/fechas';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { SEPARADOR, rotuloPrueba } from '@/lib/sport/rotulos';
import { cn, esFechaIsoReal, titular } from '@/lib/utils';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';

/**
 * Un resultado de «Para ti», al estilo de una red social pero en una sola
 * fila: retrato, bandera, quién y cuándo; el torneo; la prueba; y, a la
 * derecha, el puesto (disco del color de la medalla del 1 al 3) con los
 * participantes debajo. Sin club: en Explorar no se enseñan.
 */

/** «Espada femenina M17 · Equipos»: el rótulo común de una prueba. */
export function textoPrueba(p: Pick<EntradaSiguiendo['prueba'], 'arma' | 'genero' | 'categoria' | 'formato'>): string {
  return rotuloPrueba(p);
}

/** Día y mes; el año sólo si no es el actual. */
function Fecha({ iso }: { iso: string | null }) {
  const dia = iso?.slice(0, 10) ?? '';
  if (!esFechaIsoReal(dia)) return null;
  return (
    <time dateTime={dia} title={fechaCorta(dia, { anio: 'siempre' })} className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {fechaCorta(dia)}
    </time>
  );
}

const AVANZAR = [TIPO_TRANSICION.avanzar];

const SUBRAYADO = 'rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/**
 * Toda la tarjeta lleva a la ficha: el enlace del nombre se estira sobre ella
 * con un `after` invisible, así el toque es la fila entera sin que se dibuje
 * ningún botón. El torneo queda por encima con su propio enlace, que se toca
 * en 44 px (`AREA_TACTIL`) sin mover las líneas.
 */
export function TarjetaSiguiendo({ e }: { e: EntradaSiguiendo }) {
  const nombre = nombreVisible(e.persona.nombre) || e.persona.nombre;
  const torneo = nombrePrueba({ nombre: e.prueba.torneo, formato: e.prueba.formato, fuente: e.prueba.fuente });
  const lugar = [torneo, e.prueba.ciudad ? titular(e.prueba.ciudad) : null].filter(Boolean).join(SEPARADOR);
  const prueba = textoPrueba(e.prueba);
  const de = e.puesto !== null && e.participantes > 0 ? e.participantes : null;
  return (
    <li className="min-w-0">
      <article className="relative flex min-w-0 items-center gap-3 py-3" aria-label={`${nombre}, ${torneo}`}>
        <Avatar personaId={e.persona.id} nombre={nombre} tamano={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex min-w-0 items-center gap-2 text-sm leading-5">
            {e.persona.pais ? <BanderaPais pais={e.persona.pais} soloBandera className="shrink-0" /> : null}
            <Link
              href={rutaFicha(e.persona.id)}
              prefetch={false}
              transitionTypes={AVANZAR}
              title={nombre}
              className={cn(SUBRAYADO, 'min-w-0 truncate font-semibold after:absolute after:inset-0')}
            >
              {nombre}
            </Link>
            <Fecha iso={e.fecha} />
          </p>
          <Link
            href={construirUrlEdicion(e.prueba.edicionId, { prueba: e.prueba.id, persona: e.persona.id })}
            prefetch={false}
            transitionTypes={AVANZAR}
            title={lugar}
            className={cn(SUBRAYADO, AREA_TACTIL, 'relative z-[1] block min-w-0 text-sm leading-5')}
          >
            {/* El recorte va dentro: con `overflow: hidden` en el enlace, su `::after` de 44 px quedaría cortado. */}
            <span className="block truncate">{lugar}</span>
          </Link>
          <p className="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
            <EtiquetaTipoCompeticion clasificacion={e.clasificacion} />
            <span className="min-w-0 truncate" title={prueba}>{prueba}</span>
          </p>
        </div>
        <div className="flex w-10 shrink-0 flex-col items-center gap-1">
          <Puesto puesto={e.puesto} tamano="md" />
          {de !== null ? (
            <span className="text-xs leading-none text-muted-foreground tabular-nums">
              <span className="sr-only">de </span><span aria-hidden="true">/</span>{de}
            </span>
          ) : e.puesto === null && e.puestoLiteral ? (
            <span className="sr-only">{e.puestoLiteral}</span>
          ) : null}
        </div>
      </article>
    </li>
  );
}
