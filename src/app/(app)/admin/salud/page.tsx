import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { CambiosPanel } from '@/components/admin/cambios-panel';
import { SaludPanel } from '@/components/admin/salud-panel';
import { saludDeLaIngestion, sospechasDeCambios } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Salud de la ingestión' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Salud de la ingestión"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const [{ fuentes, cuarentenaPorFuente, ultimas }, sospechas] = await Promise.all([
    saludDeLaIngestion(),
    sospechasDeCambios(),
  ]);
  const conRetraso = fuentes.filter((f) => f.stale).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Salud de la ingestión"
        contexto={
          conRetraso === 0
            ? 'Las cinco fuentes se han leído en las últimas 48 horas.'
            : `${conRetraso} ${conRetraso === 1 ? 'fuente lleva' : 'fuentes llevan'} más de 48 horas sin leerse: lo que enseña el calendario puede estar desfasado.`
        }
      />
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-base font-semibold">Cambios por revisar</h2>
        <CambiosPanel sospechas={sospechas} />
      </section>
      <SaludPanel
        fuentes={fuentes}
        cuarentenaPorFuente={cuarentenaPorFuente}
        ultimas={ultimas}
      />
    </div>
  );
}
