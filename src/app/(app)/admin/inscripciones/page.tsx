import { BandejaInscripciones } from '@/components/admin/bandeja-inscripciones';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { listarBandejaInscripciones } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inscripciones' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Inscripciones"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const filas = await listarBandejaInscripciones();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Inscripciones"
        contexto="Lo que ya validó el club y espera a la federación, de la competición más próxima a la más lejana."
      />
      <BandejaInscripciones filas={filas} />
    </div>
  );
}
