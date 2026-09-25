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
        contexto="Filas que no validaron al leerlas y por eso no entraron en el calendario. Aquí está el porqué de cada una."
      />
      <CuarentenaPanel filas={filas} />
    </div>
  );
}
