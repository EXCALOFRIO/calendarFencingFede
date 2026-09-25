import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { TiraSecciones } from '@/components/admin/tira-secciones';
import { Toaster } from '@/components/ui/sonner';

export const dynamic = 'force-dynamic';

/**
 * Frontera de la gestión.
 *
 * Todo lo que cuelga de `/admin` es de la dirección técnica, así que el
 * permiso se comprueba UNA vez aquí en lugar de repetirlo en cada página. Y
 * se comprueba recogiendo la excepción de `requireRole`: si se dejara subir,
 * un seleccionador que teclea `/admin/normativa` se encontraría un 500 en
 * vez de una explicación.
 *
 * Cada página vuelve a llamar a `exigirRol` por su cuenta. Es a propósito: un
 * layout no es una frontera de seguridad —una petición de sólo el segmento de
 * página lo saltaría— y las acciones de servidor tienen la suya propia.
 */
export default async function GestionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const acceso = await exigirRol('admin');

  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Gestión"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <TiraSecciones />
      {children}
      {/* El panel es la única zona con acciones que escriben, así que el
          avisador vive aquí y no en el layout de la aplicación. */}
      <Toaster position="bottom-center" closeButton richColors />
    </div>
  );
}
