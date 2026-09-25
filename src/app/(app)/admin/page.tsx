import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PANTALLAS_ADMIN } from '@/components/admin/admin-screens';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera, Cifra } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { formatDateTimeEs } from '@/lib/utils';
import { resumenGestion } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gestión' };

/**
 * Portada de la gestión.
 *
 * Primero las cuatro cifras por las que alguien entra aquí —lo que espera una
 * decisión— y después el índice de secciones. Al revés (el índice arriba)
 * obliga a abrir cuatro pantallas para averiguar si hay algo que hacer.
 *
 * El índice es UNA lista, no siete tarjetas iguales: siete tarjetas del mismo
 * tamaño no jerarquizan nada y en un móvil son siete pantallas de scroll.
 */
export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso titulo="Gestión" motivo={acceso.motivo} autenticado={acceso.autenticado} />
    );
  }

  const resumen = await resumenGestion();

  const contadores: Record<string, { valor: number; tono: 'aviso' | 'apagado' }> = {
    inscripciones: {
      valor: resumen.esperandoFederacion,
      tono: resumen.esperandoFederacion > 0 ? 'aviso' : 'apagado',
    },
    cuarentena: {
      valor: resumen.cuarentena,
      tono: resumen.cuarentena > 0 ? 'aviso' : 'apagado',
    },
    emparejar: {
      valor: resumen.sinEmparejar,
      tono: resumen.sinEmparejar > 0 ? 'aviso' : 'apagado',
    },
    fuentes: {
      valor: resumen.fuentesConRetraso,
      tono: resumen.fuentesConRetraso > 0 ? 'aviso' : 'apagado',
    },
    usuarios: { valor: resumen.cuentas, tono: 'apagado' },
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Gestión"
        contexto={
          resumen.ultimaEjecucion
            ? `Última lectura de las fuentes: ${formatDateTimeEs(resumen.ultimaEjecucion)}.`
            : 'Todavía no se ha ejecutado ninguna lectura de las fuentes.'
        }
      />

      <div className="flex flex-wrap gap-2">
        <Cifra
          valor={resumen.esperandoFederacion}
          palabra="esperan a la RFEE"
          detalle="validadas por su club"
          tono={resumen.esperandoFederacion > 0 ? 'aviso' : 'apagado'}
          href="/admin/inscripciones"
        />
        <Cifra
          valor={resumen.listasParaEnviar}
          palabra="listas para enviar"
          detalle="aprobadas, sin exportar"
          tono={resumen.listasParaEnviar > 0 ? 'ok' : 'apagado'}
          href="/admin/inscripciones"
        />
        <Cifra
          valor={resumen.sinEmparejar}
          palabra="resultados sin asignar"
          detalle="llegaron sin licencia"
          tono={resumen.sinEmparejar > 0 ? 'aviso' : 'apagado'}
          href="/admin/emparejar"
        />
        <Cifra
          valor={resumen.cuarentena}
          palabra="filas en cuarentena"
          detalle="no entraron al calendario"
          tono={resumen.cuarentena > 0 ? 'urgente' : 'apagado'}
          href="/admin/cuarentena"
        />
        <Cifra
          valor={`${resumen.fuentesTotales - resumen.fuentesConRetraso}/${resumen.fuentesTotales}`}
          palabra="fuentes al día"
          detalle="leídas hace menos de 48 h"
          tono={resumen.fuentesConRetraso > 0 ? 'aviso' : 'ok'}
          href="/admin/salud"
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Secciones</h2>

        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {PANTALLAS_ADMIN.map((pantalla) => {
            const Icono = pantalla.icono;
            const contador = pantalla.contador
              ? contadores[pantalla.contador]
              : undefined;
            const unidad = pantalla.unidad;

            return (
              <li key={pantalla.href}>
                <Link
                  href={pantalla.href}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent"
                >
                  <Icono
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{pantalla.titulo}</span>
                      {/* Pastilla apagada a propósito: el color de alarma ya
                          está arriba, en las cifras. Repetirlo siete veces
                          aquí lo convertiría en decoración. */}
                      {contador && unidad && contador.valor > 0 ? (
                        <Badge variant="secondary" className="font-normal">
                          {contador.valor}{' '}
                          {contador.valor === 1 ? unidad[0] : unidad[1]}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="medida text-sm text-muted-foreground">
                      {pantalla.resumen}
                    </span>
                  </span>
                  <ChevronRight
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
