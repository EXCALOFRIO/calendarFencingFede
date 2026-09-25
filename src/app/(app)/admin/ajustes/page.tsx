import { AjustesPanel } from '@/components/admin/ajustes-panel';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { listarEquipo } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ajustes' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso titulo="Ajustes" motivo={acceso.motivo} autenticado={acceso.autenticado} />
    );
  }

  const equipo = await listarEquipo();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Ajustes"
        contexto="Quién es dirección técnica y quién lleva cada arma. Es lo único que abre el panel."
      />
      <AjustesPanel equipo={equipo} />
    </div>
  );
}
