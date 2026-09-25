import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { UsuariosPanel } from '@/components/admin/usuarios-panel';
import { listarAltasRecientes, listarClubesParaAlta } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usuarios' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Usuarios"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const [clubes, altas] = await Promise.all([
    listarClubesParaAlta(),
    listarAltasRecientes(),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Usuarios"
        contexto="Alta de una persona o importación de un listado entero. La importación se previsualiza fila a fila antes de escribir nada."
      />
      <UsuariosPanel clubes={clubes} altas={altas} />
    </div>
  );
}
