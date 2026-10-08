import { Buscador } from '@/components/alta/buscador';
import { BuscadorNombre } from '@/components/alta/buscador-nombre';
import { FichaVinculada } from '@/components/alta/ficha-vinculada';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { MENSAJE_RECHAZO, buscarPorNombre } from '@/lib/altas/por-nombre';
import { buscarEnRanking, cancelarSolicitudVinculo, vincularFicha } from './acciones';
import { getResumenFicha } from './consultas';
import { solicitudPendiente } from '@/lib/altas/solicitudes';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vincula tu ficha' };

/**
 * «Vincula tu ficha»: la pantalla que faltaba para que una cuenta recién
 * creada sirva de algo.
 *
 * Hasta ahora, quien se registraba no tenía ficha de tirador, y sin ficha la
 * aplicación no sabe su arma ni su categoría: el calendario no filtra nada,
 * «Mi estado» sale vacío y el ranking no le dice nada. La única salida era
 * pedirle a un administrador que se la creara a mano.
 *
 * Y no hacía falta, porque el dato ya estaba dentro: el ranking oficial de la
 * RFEE se ingiere cada noche con nombre, licencia, fecha de nacimiento, club,
 * arma, género, categoría, puesto y puntos de 808 tiradores. Esta pantalla solo
 * hace que una persona pueda reconocerse en esa lista.
 *
 * -------------------------------------------------------------------------
 * SE ENTRA POR EL NOMBRE, NO POR LA LICENCIA
 * -------------------------------------------------------------------------
 * La primera versión pedía el número de licencia de la RFEE como prueba. El
 * usuario lo dijo claro: *«¿no puedes pillarlo por su nombre? que le pregunten
 * al entrar su nombre… y de ahí que pille de la lista aunque no lo haya
 * escrito perfecto, le pregunte "¿eres tú?"»*. Y tenía razón en lo práctico: el
 * nombre lo lleva uno en la cabeza y la licencia en un cajón, así que pedir la
 * licencia para poder mirar el calendario era un muro puesto en la puerta.
 *
 * La vía de la licencia no se ha borrado —vive en `?con=licencia`— porque
 * ayuda a encontrar la fila exacta, pero no acredita su propiedad. Ambas vías
 * necesitan una revisión independiente de la dirección técnica.
 *
 * -------------------------------------------------------------------------
 * TRES ESTADOS, UNA URL
 * -------------------------------------------------------------------------
 * Si la cuenta NO tiene ficha, se enseña el buscador o su solicitud pendiente.
 * Si la tiene —porque se aprobó el vínculo o porque volvió a mirar—, se enseña la ficha con su
 * puesto oficial. Son la misma pantalla a propósito: la confirmación de que el
 * alta funcionó es exactamente lo que se ve al volver, así que no hay dos
 * versiones de la verdad que puedan separarse.
 *
 * No hay redirección forzosa desde `/` hacia aquí, y es una decisión: un
 * seleccionador y la dirección técnica tampoco tienen ficha, y no tienen por
 * qué acabar en una pantalla de alta cada vez que entran.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{
    hecha?: string;
    pendiente?: string;
    con?: string;
    /** Lo que se escribió en «¿Cómo te llamas?». La búsqueda es un GET. */
    q?: string;
    /** Código de `MotivoRechazo` si no se pudo registrar la solicitud. */
    fallo?: string;
  }>;
}) {
  const perfil = await requireProfile();
  const [atletas, parametros] = await Promise.all([
    getManagedAthletes(perfil.profileId),
    searchParams,
  ]);

  const mia = atletas[0];
  if (mia) {
    const resumen = await getResumenFicha(mia.id);
    if (resumen) {
      return (
        <FichaVinculada
          resumen={resumen}
          reciente={parametros.hecha === '1'}
          varias={atletas.length > 1}
        />
      );
    }
  }
  const pendiente = await solicitudPendiente(perfil.profileId);
  if (pendiente) {
    return (
      <section className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl">Solicitud pendiente de revisión</h1>
        <p role="status" className="medida text-sm text-muted-foreground">
          La dirección técnica debe verificar tu identidad antes de vincular la ficha.
          Todavía no tienes permisos para gestionar sus convocatorias o inscripciones.
          Puedes seguir consultando el calendario.
        </p>
        <p className="text-sm">Referencia en la fuente: {pendiente.clave}</p>
        <form action={cancelarSolicitudVinculo}>
          <Button type="submit" variant="outline">Cancelar y elegir otra ficha</Button>
        </form>
      </section>
    );
  }

  /**
   * La vía larga, con el número de licencia, sigue existiendo en `?con=licencia`.
   *
   * No se enseña de primeras porque pedirle a alguien el carné de la RFEE para
   * poder mirar el calendario era exactamente el muro que había que quitar, y
   * porque el nombre lo tiene en la cabeza y la licencia en un cajón. Pero no
   * se borra: ayuda a localizar la fila exacta. No es una credencial ni evita
   * la revisión independiente antes de conceder la propiedad.
   */
  if (parametros.con === 'licencia') {
    return (
      <Buscador
        buscar={buscarEnRanking}
        vincular={vincularFicha}
        nombreCuenta={perfil.fullName}
        esPersonal={perfil.role === 'athlete'}
      />
    );
  }

  /**
   * La búsqueda se hace aquí, en el servidor, con lo que trae la URL.
   *
   * No hay acción de cliente para buscarse porque buscarse es LEER: así
   * funciona sin JavaScript, se puede recargar sin perder la lista y el botón
   * «atrás» del móvil hace lo que uno espera. Lo único que escribe es «Sí, soy
   * yo». Y `requireProfile()` ya ha corrido arriba: esto no es un buscador
   * público ni con `?q=` en la URL.
   */
  const escrito = parametros.q?.trim() ?? '';
  const resultado = escrito ? await buscarPorNombre(escrito) : null;

  const fallo =
    parametros.fallo && parametros.fallo in MENSAJE_RECHAZO
      ? MENSAJE_RECHAZO[parametros.fallo as keyof typeof MENSAJE_RECHAZO]
      : null;

  return (
    <BuscadorNombre
      escrito={escrito}
      resultado={resultado}
      fallo={fallo}
      nombreCuenta={perfil.fullName}
      esPersonal={perfil.role === 'athlete'}
    />
  );
}
