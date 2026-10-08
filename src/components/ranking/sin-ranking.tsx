import { Calculator, CalendarOff, FileText, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { Boton } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import type { getRankingStatus } from '@/lib/queries/ranking';

type Estado = Awaited<ReturnType<typeof getRankingStatus>>;

/**
 * Por qué no hay ranking.
 *
 * Son cuatro motivos distintos y cada uno se arregla de una forma distinta,
 * así que se dicen por separado. "No hay datos" no le sirve a nadie: ni al
 * tirador, que no sabe si es culpa suya, ni a la dirección técnica, que es
 * quien puede arreglarlo.
 */
export function SinRanking({ estado, esAdmin }: { estado: Estado; esAdmin: boolean }) {
  const caso = motivo(estado);

  return (
    <EstadoVacio
      icono={caso.icono}
      titulo={caso.titulo}
      descripcion={caso.texto}
      accion={
        esAdmin && caso.accion ? (
          <Boton asChild>
            <Link href={caso.accion.href}>{caso.accion.texto}</Link>
          </Boton>
        ) : undefined
      }
    />
  );
}

function motivo(estado: Estado): {
  icono: typeof Calculator;
  titulo: string;
  texto: string;
  accion: { href: string; texto: string } | null;
} {
  if (!estado.season) {
    return {
      icono: CalendarOff,
      titulo: 'No hay temporada en curso',
      texto:
        'El ranking se calcula por temporada, y ahora mismo no hay ninguna marcada como actual. En cuanto la dirección técnica abra la temporada, aquí saldrá la clasificación por arma, género y categoría.',
      accion: { href: '/admin', texto: 'Abrir la temporada en Gestión' },
    };
  }

  if (!estado.hasRules) {
    return {
      icono: FileText,
      titulo: 'Falta la normativa del ranking',
      texto:
        `Hay ${estado.resultsTotal} resultados cargados de la temporada ${estado.season.label}, pero sin la normativa (cuántas pruebas cuentan, qué puntos da cada puesto y qué coeficiente lleva cada circuito) no se puede calcular nada. Se carga desde el documento oficial, no se inventa.`,
      accion: { href: '/admin', texto: 'Cargar la normativa en Gestión' },
    };
  }

  if (estado.resultsTotal === 0) {
    return {
      icono: ListChecks,
      titulo: 'Todavía no hay resultados',
      texto:
        'La normativa ya está cargada, pero no se ha leído ningún resultado de la temporada. En cuanto entren los primeros resultados de la fuente oficial, el ranking se calcula solo y aparece aquí.',
      accion: { href: '/admin', texto: 'Ver la ingestión de datos' },
    };
  }

  return {
    icono: Calculator,
    titulo: 'El ranking no se ha calculado todavía',
    texto:
      `Hay normativa y ${estado.resultsMatched} resultados emparejados con tiradores` +
      (estado.resultsUnmatched > 0
        ? ` (y ${estado.resultsUnmatched} sin emparejar)`
        : '') +
      ', pero nadie ha lanzado el cálculo. Se lanza desde Gestión y tarda unos segundos.',
    accion: { href: '/admin', texto: 'Ir a Gestión' },
  };
}
