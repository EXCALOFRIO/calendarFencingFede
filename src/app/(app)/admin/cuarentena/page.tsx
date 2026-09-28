import { CuarentenaPanel } from '@/components/admin/cuarentena-panel';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { listarCuarentena } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cuarentena' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Cuarentena"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const filas = await listarCuarentena();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Cuarentena"
        contexto="Lo que no validó al leerlo y no entró al calendario, con el porqué."
      />
      <CuarentenaPanel filas={filas} />
    </div>
  );
}
