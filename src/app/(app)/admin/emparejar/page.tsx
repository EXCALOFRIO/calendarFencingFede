import { EmparejarPanel } from '@/components/admin/emparejar-panel';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import {
  contarResultadosEmparejados,
  listarSinEmparejar,
  listarTiradoresParaEmparejar,
} from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Emparejar resultados' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Emparejar resultados"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const [resultados, tiradores, yaEmparejados] = await Promise.all([
    listarSinEmparejar(),
    listarTiradoresParaEmparejar(),
    contarResultadosEmparejados(),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Emparejar resultados"
        contexto="Resultados leídos de la fuente que no se han podido asignar por licencia. Nunca se emparejan por nombre solos: hay homónimos."
      />
      <EmparejarPanel
        resultados={resultados}
        tiradores={tiradores}
        yaEmparejados={yaEmparejados}
      />
    </div>
  );
}
