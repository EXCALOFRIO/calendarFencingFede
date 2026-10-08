import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { fechaCorta as fechaInterfaz } from '@/lib/fechas';
import type { FilaListaPerfil } from '@/lib/sport/explorar/resultados-perfil';
import { rotuloArma } from '@/lib/sport/rotulos';
import { cn, titular } from '@/lib/utils';
import { EtiquetaCategoria, EtiquetaTipoCompeticion } from '../etiqueta-competicion';
import { DiscoPuesto } from './medallas';

/**
 * Fila de resultado del perfil: disco del puesto, nombre de la prueba en una
 * línea, pastillas de tipo y categoría y una línea de fecha y sede. Toda la
 * fila abre la prueba; la fuente queda en un icono aparte.
 */

/** «5 oct 2025»: en un historial de varias temporadas el año siempre hace falta. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  return fechaInterfaz(iso, { anio: 'siempre' }) || iso;
}

const NOMBRE_FUENTE: Record<string, string> = { fie: 'FIE', efc: 'EFC', rfee_pdf: 'RFEE', engarde: 'Engarde', fww: 'Fencing Worldwide' };

/** Nombre de la fuente para el enlace; una fuente desconocida no enseña su clave interna. */
function nombreFuente(fuente: string): string {
  return NOMBRE_FUENTE[fuente] ?? (fuente.startsWith('skermo') ? 'Skermo' : 'la fuente');
}

export function IconoFuente({ url, fuente, className }: { url: string | null; fuente: string; className?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Ver en ${nombreFuente(fuente)}`}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <ExternalLink className="size-4" aria-hidden />
      <span className="sr-only">Ver en {nombreFuente(fuente)}</span>
    </a>
  );
}

export function Asaltos({ v, d, className }: { v: number; d: number; className?: string }) {
  return (
    <span className={cn('shrink-0 text-xs whitespace-nowrap text-muted-foreground', className)} title="Asaltos ganados y perdidos en esta prueba">
      <span className="cifra text-sm text-foreground">{v}</span>V{' '}
      <span className="cifra text-sm text-foreground">{d}</span>D
    </span>
  );
}

export function FilaResultado({ r, conArma = false }: { r: FilaListaPerfil; conArma?: boolean }) {
  return (
    <li className="flex min-w-0 items-center bg-card pr-1 hover:bg-secondary">
      <Link
        href={r.href}
        prefetch={false}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none sm:pl-4"
      >
        <DiscoPuesto puesto={r.puesto} puestoPublicado={r.puestoPublicado} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm leading-tight font-medium">{r.nombre}</span>
          {/* Si no caben las pastillas y los asaltos, los asaltos bajan de línea en vez de recortarse. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {r.tipoEnNombre ? null : <EtiquetaTipoCompeticion clasificacion={r.clasificacion} tamano="sm" />}
            <EtiquetaCategoria codigo={r.categoria} tamano="sm" />
            {conArma ? <span className="truncate text-xs text-muted-foreground">{rotuloArma(r.arma)}</span> : null}
            {r.asaltos ? <Asaltos v={r.asaltos.victorias} d={r.asaltos.derrotas} className="ml-auto pl-1" /> : null}
          </span>
          {/* Fecha y sede separadas por hueco, sin «·»; de la sede sólo la bandera y la ciudad. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={r.fecha ?? undefined} className="shrink-0">{fechaCorta(r.fecha)}</time>
            {r.pais ? <BanderaPais pais={r.pais} soloBandera className="shrink-0" /> : null}
            {r.ciudad ? <span className="min-w-0 truncate">{titular(r.ciudad)}</span> : null}
          </span>
        </span>
      </Link>
      <IconoFuente url={r.fuenteUrl} fuente={r.fuente} />
    </li>
  );
}
