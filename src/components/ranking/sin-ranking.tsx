import { Calculator, FileText, ListChecks, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
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
    <div className="flex max-w-2xl flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-10">
      <caso.icono className="size-6 text-muted-foreground" aria-hidden />
      <h2 className="text-xl">{caso.titulo}</h2>
      <p className="medida text-sm text-muted-foreground">{caso.texto}</p>
      {esAdmin && caso.accion ? (
        <Button variant="outline" asChild className="mt-2">
          <Link href={caso.accion.href}>{caso.accion.texto}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function motivo(estado: Estado): {
  icono: typeof Trophy;
  titulo: string;
  texto: string;
  accion: { href: string; texto: string } | null;
} {
  if (!estado.season) {
    return {
      icono: Trophy,
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
