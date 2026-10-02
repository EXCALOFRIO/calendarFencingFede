import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Seccion } from '@/components/estado/piezas';
import { EstadoFicha, FichaCompleta } from '@/components/explorar/ficha-deportiva';
import { Skeleton } from '@/components/ui/skeleton';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { RUTA_PERFIL, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { rutaFicha } from '@/lib/sport/explorar/url';

const TITULO = 'Tu historial deportivo';

/**
 * Historial nacional e internacional de la persona deportiva de la cuenta,
 * visible por defecto en `/perfil`. La persona sale de la sesión en el
 * servidor (nunca de un parámetro) y sólo si está confirmada por licencia o
 * identificador de federación; sin vínculo se explica por qué y se ofrece
 * Explorar, en lugar de adjudicar un homónimo.
 *
 * Los datos de la cuenta (correo, papel, calendario) viven en las otras
 * secciones de la página: esta sección sólo recibe el DTO deportivo.
 */
export async function HistorialPropio({ criterios }: { criterios: CriteriosFicha }) {
  const vista = await cargarFichaPantalla(contextoReal(), undefined, criterios);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  if (vista.tipo !== 'ok') {
    return (
      <Seccion titulo={TITULO}>
        <div className="pt-3">
          <EstadoFicha vista={vista} incrustado />
        </div>
      </Seccion>
    );
  }

  return (
    <Seccion
      titulo={TITULO}
      contexto="Lo que publican las federaciones sobre ti"
      accion={
        <Link
          href={rutaFicha(vista.ficha.id)}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Abrir la ficha como la ven los demás
        </Link>
      }
    >
      <div className="pt-4">
        <FichaCompleta
          ficha={vista.ficha}
          historial={vista.historial}
          base={RUTA_PERFIL}
          criterios={criterios}
          nivel="seccion"
          conTitulo={false}
        />
      </div>
    </Seccion>
  );
}

export function HistorialPropioCargando() {
  return (
    <Seccion titulo={TITULO}>
      <div role="status" aria-live="polite" className="flex flex-col gap-3 pt-4">
        <span className="sr-only">Cargando tu historial deportivo…</span>
        <Skeleton className="h-6 w-1/2" />
        <div className="flex flex-col divide-y rounded-md border bg-card" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="px-3 py-4">
              <Skeleton className="h-5 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </Seccion>
  );
}
