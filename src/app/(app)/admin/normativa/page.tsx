import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { NormativaPanel } from '@/components/admin/normativa-panel';
import { Cabecera } from '@/components/admin/piezas';
import { listarNormativa } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Normativa' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Normativa"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const normativa = await listarNormativa();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Normativa"
        contexto="Plazos, categorías y reglas del ranking. Ningún número de la normativa vive en el código, y cada valor guarda de qué documento sale."
      />
      <NormativaPanel normativa={normativa} />
    </div>
  );
}
