import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { SaludPanel } from '@/components/admin/salud-panel';
import { saludDeLaIngestion } from '../consultas';

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

  const { fuentes, cuarentenaPorFuente, ultimas } = await saludDeLaIngestion();
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
      <SaludPanel
        fuentes={fuentes}
        cuarentenaPorFuente={cuarentenaPorFuente}
        ultimas={ultimas}
      />
    </div>
  );
}
