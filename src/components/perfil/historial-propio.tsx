import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Seccion } from '@/components/estado/piezas';
import { EstadoFicha, FichaCompleta } from '@/components/explorar/ficha-deportiva';
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
      accion={
        <Link
          href={rutaFicha(vista.ficha.id)}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          Ver ficha pública
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
