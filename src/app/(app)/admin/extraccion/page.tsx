import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { ExtraccionPanel } from '@/components/admin/extraccion-panel';
import { Cabecera } from '@/components/admin/piezas';
import { leerConfiguracionIa } from '@/lib/ai/extract';
import { listarExtracciones, resumenExtraccion } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Extracción de circulares' };

/**
 * Revisión de lo que el modelo ha sacado de las circulares en PDF.
 *
 * El valor, la cita literal y el trozo del documento, uno al lado del otro, y
 * dos botones. Ese es todo el trabajo: comprobar que la frase dice lo que el
 * campo dice. Nada de lo que hay aquí se ha publicado en ningún sitio.
 */
export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Extracción de circulares"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const config = leerConfiguracionIa();
  const [resumen, pendientes, revisadas, sinDatos] = await Promise.all([
    resumenExtraccion(),
    listarExtracciones('pendientes'),
    listarExtracciones('revisadas'),
    listarExtracciones('sin_datos'),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Extracción de circulares"
        contexto="Plazos, cuotas, horarios y sedes sacados del PDF por un modelo. Cada dato viene con la frase del documento de la que sale; tú decides si entra."
      />
      <ExtraccionPanel
        resumen={resumen}
        pendientes={pendientes}
        revisadas={revisadas}
        sinDatos={sinDatos}
        modelo={config.activa ? config.modelo : null}
      />
    </div>
  );
}
