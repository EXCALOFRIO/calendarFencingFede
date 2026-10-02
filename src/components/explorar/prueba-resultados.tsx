import { CircleCheck, CircleDashed, CircleX, ExternalLink, TriangleAlert } from 'lucide-react';
import {
  ETIQUETA_PROVEEDOR,
  TEXTO_ESTADO_RESULTADOS,
  TEXTO_SIN_ENLACE,
  type EnlaceDto,
  type EstadoResultados,
  type PruebaDeEdicion,
} from '@/lib/sport/explorar/edicion-modelo';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';

/**
 * Piezas de lectura de una prueba con resultados, compartidas por la página de
 * edición y la banda de resultados de la ficha del calendario. El estado se
 * dice con icono y palabras, nunca sólo con color.
 */

const ICONO_ESTADO: Record<EstadoResultados, { icono: typeof CircleCheck; tono: string }> = {
  completo: { icono: CircleCheck, tono: 'text-ok' },
  parcial: { icono: TriangleAlert, tono: 'text-warn' },
  sin_resultados: { icono: CircleX, tono: 'text-muted-foreground' },
  pendiente: { icono: CircleDashed, tono: 'text-muted-foreground' },
  error: { icono: TriangleAlert, tono: 'text-danger' },
  conflicto: { icono: TriangleAlert, tono: 'text-warn' },
};

/** Nombre de la prueba: arma, género y categoría tal y como la publica la fuente. */
export function nombreDePrueba(p: Pick<PruebaDeEdicion, 'arma' | 'genero' | 'categoria' | 'formato'>): string {
  const categoria =
    p.categoria.raw ?? CATEGORY_LABEL[p.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? p.categoria.codigo;
  return `${WEAPON_LABEL[p.arma]} ${GENDER_LABEL[p.genero].toLowerCase()} · ${categoria} · ${
    p.formato === 'EQUIPOS' ? 'equipos' : 'individual'
  }`;
}

export function EstadoResultadosPrueba({
  estado,
  importados,
  className,
}: {
  estado: EstadoResultados;
  importados: number;
  className?: string;
}) {
  const { icono: Icono, tono } = ICONO_ESTADO[estado];
  const texto = TEXTO_ESTADO_RESULTADOS[estado];
  return (
    <p className={cn('flex min-w-0 flex-col gap-0.5 text-sm', className)}>
      <span className={cn('inline-flex items-center gap-1.5 font-medium', tono)}>
        <Icono className="size-4 shrink-0" aria-hidden />
        {texto.titulo}
        {importados > 0 ? (
          <span className="font-normal text-muted-foreground">
            ({importados} {importados === 1 ? 'puesto' : 'puestos'})
          </span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{texto.ayuda}</span>
    </p>
  );
}

const ENLACE =
  'inline-flex min-h-11 items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0';

/**
 * Enlaces de resultados de una prueba. Sólo se pinta un enlace cuando el estado
 * lo permite; el resto dice por qué no hay. Fencing Time Live sólo sigue el
 * torneo: se avisa de que exige cuenta y de que no hay resultados importados.
 */
export function EnlacesResultados({ enlaces }: { enlaces: EnlaceDto[] }) {
  if (enlaces.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin enlaces de resultados comprobados. No significa que la prueba no tenga resultados.
      </p>
    );
  }
  return (
    <ul aria-label="Enlaces de resultados" className="flex flex-col gap-1">
      {enlaces.map((e) => {
        const nombre = ETIQUETA_PROVEEDOR[e.proveedor];
        if (e.tipo === 'sin_enlace') {
          return (
            <li key={e.proveedor} className="text-xs text-muted-foreground">
              {nombre}: {TEXTO_SIN_ENLACE[e.motivo]}.
            </li>
          );
        }
        return (
          <li key={e.proveedor} className="flex flex-col">
            <a href={e.url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
              {e.tipo === 'verificado' ? `Resultados en ${nombre}` : `Seguir el torneo en ${nombre}`}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {e.tipo === 'solo_enlace' ? (
              <span className="text-xs text-muted-foreground">
                Enlace al torneo{e.proveedor === 'ftl' ? ' (exige cuenta)' : ' (sin comprobar el contenido)'}: los
                resultados no están importados.
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
