import { TIPOS_FIE } from '@/lib/sport/explorar/estadisticas-tipo';
import { categoriaVisible } from '@/lib/sport/explorar/presentacion';
import { clasificarCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import type { ClasificacionCompeticion, TonoTipo } from '@/lib/sport/explorar/tipos-social';
import type { ResultadoHistorial } from '@/lib/sport/explorar/tipos';
import { cn } from '@/lib/utils';

/**
 * Pastillas de tipo de competición y de categoría. Las clases van escritas
 * enteras: Tailwind sólo genera las que encuentra literalmente en el código,
 * así que `text-${tono}` no pintaría nada.
 *
 * Contraste del texto (tema oscuro, medido sobre `--card`): FIE 5,7:1 y
 * autonómico 5,4:1 sobre su tinte, RFEE y EFC 9:1, dorado 9,9:1, carmesí
 * sobre `--marcado` 4,7:1 y el gris apagado 7,9:1. Los tintes son opacos
 * (`color-mix` en `globals.css`): un `bg-x/15` no es fiable en este tema.
 */
export const CLASES_TONO: Record<TonoTipo, string> = {
  gold: 'border-gold/60 bg-card text-gold',
  primary: 'border-primary-text/60 bg-marcado text-primary-text',
  'org-fie': 'border-transparent bg-org-fie-tinte text-org-fie',
  'org-efc': 'border-transparent bg-org-efc-tinte text-org-efc',
  'org-rfee': 'border-transparent bg-org-rfee-tinte text-org-rfee',
  'org-aut': 'border-transparent bg-org-aut-tinte text-org-aut',
  off: 'border-filete-alto bg-card text-muted-foreground',
};

const PASTILLA =
  'inline-flex max-w-full min-w-0 shrink-0 items-center rounded-full border text-xs leading-none font-semibold whitespace-nowrap';

/** Las dos alturas de pastilla del sistema (`sistema/pastilla`): 20 px dentro de filas, 24 en cabeceras. */
const TAMANO = { sm: 'h-5 px-2', md: 'h-6 px-3' } as const;
export type TamanoEtiqueta = keyof typeof TAMANO;

/** Tipo de competición coloreado por organismo; el nombre largo queda en el `title`. */
export function EtiquetaTipoCompeticion({
  clasificacion,
  larga = false,
  tamano = 'md',
  className,
}: {
  clasificacion: Pick<ClasificacionCompeticion, 'tipo' | 'etiqueta' | 'corta' | 'tono'>;
  larga?: boolean;
  tamano?: TamanoEtiqueta;
  className?: string;
}) {
  return (
    <span
      data-tipo={clasificacion.tipo}
      data-tono={clasificacion.tono}
      title={larga ? undefined : clasificacion.etiqueta}
      className={cn(PASTILLA, TAMANO[tamano], CLASES_TONO[clasificacion.tono], className)}
    >
      <span className="truncate">{larga ? clasificacion.etiqueta : clasificacion.corta}</span>
    </span>
  );
}

export function EtiquetaCategoria({ codigo, tamano = 'md', className }: { codigo: string; tamano?: TamanoEtiqueta; className?: string }) {
  return (
    <span className={cn(PASTILLA, TAMANO[tamano], 'border-filete-alto bg-card font-medium text-foreground', className)}>
      <span className="truncate">{categoriaVisible(codigo)}</span>
    </span>
  );
}

/** Tipo y categoría juntos, como en las tarjetas de resultado y el feed. */
export function EtiquetasCompeticion({
  clasificacion,
  categoria,
  className,
}: {
  clasificacion: Pick<ClasificacionCompeticion, 'tipo' | 'etiqueta' | 'corta' | 'tono'>;
  categoria?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <EtiquetaTipoCompeticion clasificacion={clasificacion} />
      {categoria ? <EtiquetaCategoria codigo={categoria} /> : null}
    </span>
  );
}

/**
 * Tipo de un resultado del historial. `tipoDocumentado` ya viene filtrado por
 * procedencia en la SQL (`TIPO_ESTADISTICO_DOCUMENTADO`), así que se le pone
 * la fuente de evento que `tipoConProcedencia` acepta para ese código.
 */
export function clasificarResultado(r: Pick<ResultadoHistorial, 'torneo' | 'fuente' | 'tipoDocumentado'>): ClasificacionCompeticion {
  const circuito = r.tipoDocumentado;
  const fuenteEvento = circuito
    ? (TIPOS_FIE as readonly string[]).includes(circuito) ? 'fie' : 'skermo_rfee'
    : null;
  return clasificarCompeticion({
    nombre: r.torneo.nombre,
    fuente: r.fuente,
    pais: r.torneo.pais,
    circuitoEvento: circuito,
    fuenteEvento,
  });
}
