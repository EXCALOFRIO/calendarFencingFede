import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { CLASES_MEDALLA, categoriaVisible, medallaDe, nombrePrueba } from '@/lib/sport/explorar/presentacion';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { GENDER_LABEL, WEAPON_LABEL, cn, esFechaIsoReal, titular } from '@/lib/utils';
import { EtiquetaTipoCompeticion } from './etiqueta-competicion';
import { FotoDeportista } from './foto-deportista';

/**
 * Una publicación del feed de Inicio, al estilo de una red social pero en una
 * sola fila: retrato, quién y cuándo, la prueba y, a la derecha, el puesto en
 * un disco del color de la medalla. Sin club: en Explorar no se enseñan.
 */

const PRUEBA_GENERO: Record<string, string> = { M: 'masculina', F: 'femenina', MIXTO: 'mixta' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

export function textoPrueba(p: EntradaSiguiendo['prueba']): string {
  const arma = WEAPON_LABEL[p.arma as keyof typeof WEAPON_LABEL] ?? p.arma;
  const genero = PRUEBA_GENERO[p.genero] ?? GENDER_LABEL[p.genero as keyof typeof GENDER_LABEL]?.toLowerCase() ?? '';
  return `${arma} ${genero}${p.formato === 'EQUIPOS' ? ' por equipos' : ''}`.trim();
}

/** Día y mes; el año sólo si no es el actual. */
function Fecha({ iso }: { iso: string | null }) {
  if (!iso) return <span>sin fecha</span>;
  const dia = iso.slice(0, 10);
  if (!esFechaIsoReal(dia)) return <span>{dia}</span>;
  const [anio, mes, d] = dia.split('-');
  const corto = `${Number(d)} ${MESES[Number(mes) - 1]}`;
  return (
    <time dateTime={dia} title={`${corto} ${anio}`}>
      {corto}{anio === String(new Date().getFullYear()) ? '' : ` ${anio}`}
    </time>
  );
}

function DiscoPuesto({ e }: { e: EntradaSiguiendo }) {
  const medalla = medallaDe(e.puesto);
  return (
    <span
      className={cn(
        'flex size-[36px] shrink-0 items-center justify-center rounded-full border text-[13px] leading-none font-semibold tabular-nums',
        medalla ? CLASES_MEDALLA[medalla] : 'border-filete-alto bg-secondary text-foreground',
      )}
    >
      {e.puesto !== null ? (
        <>
          <span aria-hidden="true">{e.puesto}.º</span>
          <span className="sr-only">Puesto {e.puesto}{e.participantes > 0 ? ` de ${e.participantes}` : ''}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">{e.puestoLiteral ?? 'Sin puesto publicado'}</span>
        </>
      )}
    </span>
  );
}

const AVANZAR = [TIPO_TRANSICION.avanzar];

const SUBRAYADO = 'rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/**
 * Toda la tarjeta lleva a la ficha: el enlace del nombre se estira sobre ella
 * con un `after` invisible, así el toque es la fila entera (unos 68 px) sin
 * que se dibuje ningún botón. El torneo queda por encima con su propio enlace,
 * que se ve de 32 px y se toca en 44 (`AREA_TACTIL`) sin mover las líneas.
 */
export function TarjetaSiguiendo({ e }: { e: EntradaSiguiendo }) {
  const nombre = nombreVisible(e.persona.nombre) || e.persona.nombre;
  const torneo = nombrePrueba({ nombre: e.prueba.torneo, formato: e.prueba.formato, fuente: e.prueba.fuente });
  const detalle = [
    textoPrueba(e.prueba),
    e.prueba.categoria ? categoriaVisible(e.prueba.categoria) : null,
    e.puesto !== null && e.participantes > 0 ? `de ${e.participantes}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="min-w-0">
      <article className="relative flex min-w-0 items-center gap-3 py-[10px]" aria-label={`${nombre}, ${torneo}`}>
        <FotoDeportista personaId={e.persona.id} nombre={nombre} tamano="lista" />
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <p className="flex min-w-0 items-baseline gap-1.5 text-[14px] leading-[18px]">
            <Link
              href={rutaFicha(e.persona.id)}
              prefetch={false}
              transitionTypes={AVANZAR}
              className={cn(SUBRAYADO, 'min-w-0 truncate font-semibold after:absolute after:inset-0')}
            >
              {nombre}
            </Link>
            {e.persona.pais ? <BanderaPais pais={e.persona.pais} soloBandera className="shrink-0 self-center" /> : null}
            <span className="shrink-0 text-[12px] text-muted-foreground">
              <span aria-hidden="true">· </span><Fecha iso={e.fecha} />
            </span>
          </p>
          <Link
            href={construirUrlEdicion(e.prueba.edicionId, { prueba: e.prueba.id, persona: e.persona.id })}
            prefetch={false}
            transitionTypes={AVANZAR}
            className={cn(SUBRAYADO, AREA_TACTIL, 'z-[1] -mt-[5px] -mb-[10px] block min-w-0 pt-[5px] pb-[10px] text-[13px] leading-[17px]')}
          >
            {/* El recorte va dentro: con `overflow: hidden` en el enlace, su `::after` de 44 px quedaría cortado. */}
            <span className="block truncate">
              {torneo}
              {e.prueba.ciudad ? <span className="text-muted-foreground"> · {titular(e.prueba.ciudad)}</span> : null}
            </span>
          </Link>
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] leading-[16px] whitespace-nowrap text-muted-foreground">
            <EtiquetaTipoCompeticion clasificacion={e.clasificacion} className="h-[18px] px-1.5 text-[12px]" />
            <span className="min-w-0 truncate">{detalle}</span>
          </p>
        </div>
        <DiscoPuesto e={e} />
      </article>
    </li>
  );
}