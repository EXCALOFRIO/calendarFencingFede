import type { ReactNode } from 'react';
import type { FilaClasificacion } from '@/lib/sport/explorar/edicion-modelo';
import type { VistaPrueba as Vista } from '@/lib/sport/explorar/edicion-url';
import { datosDeVista, disponiblesDePrueba } from '@/lib/sport/explorar/prueba-datos';
import type { AsaltosDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import type { BasePrueba } from './enlaces';
import { vistaInicial } from './logica';
import { VistaPruebaCliente } from './vista-prueba-cliente';

/**
 * Clasificación, poules y directas de una prueba. Se pinta en el servidor y
 * al cliente sólo le cruzan los datos de la vista abierta: las otras dos las
 * pide él al cambiar de vista (o en un rato libre con buena red). Volver a
 * entrar con otra prueba, página, vista o persona monta la vista de nuevo.
 */
export function VistaPrueba({
  edicionId,
  base,
  persona,
  vista: pedida,
  clasificacion,
  asaltos: crudo,
  pieClasificacion,
  avisoAsaltos,
}: {
  edicionId: string;
  base: BasePrueba;
  /** Persona de la dirección: se resalta mientras no se escriba nada. */
  persona?: string;
  vista?: Vista;
  clasificacion: FilaClasificacion[];
  asaltos: AsaltosDePrueba | null | 'error';
  /** Paginación y avisos de la clasificación, pintados en el servidor. */
  pieClasificacion?: ReactNode;
  /** Aviso bajo poules y directas (asaltos truncados, por ejemplo). */
  avisoAsaltos?: ReactNode;
}) {
  const asaltos = crudo === 'error' ? null : crudo;
  const disponibles = disponiblesDePrueba(clasificacion, asaltos);
  const vista = vistaInicial(pedida, disponibles);
  return (
    <VistaPruebaCliente
      key={`${base.prueba}|${base.cursor}|${vista}|${persona ?? ''}`}
      edicionId={edicionId}
      base={base}
      persona={persona}
      vista={vista}
      disponibles={disponibles}
      datos={datosDeVista(vista, clasificacion, asaltos)}
      pieClasificacion={pieClasificacion}
      avisoAsaltos={avisoAsaltos}
    />
  );
}
