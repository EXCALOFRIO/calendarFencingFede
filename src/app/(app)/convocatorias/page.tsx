import { Medal } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Historico } from '@/components/convocatorias/historico';
import { PanelConvocatorias } from '@/components/convocatorias/panel-convocatorias';
import { calcularPlazo } from '@/components/convocatorias/plazo';
import { TarjetaConvocatoria } from '@/components/convocatorias/tarjeta-convocatoria';
import { armasDeArranque } from '@/lib/ambito';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import type { CallUpDetail, EventoConvocable } from '@/lib/callups/tipos';
import {
  getCallUpDetail,
  listCallUpsForAdmin,
  listCallUpsForAthletes,
  listEventosConvocables,
} from '@/lib/queries/callups';
import { armasPorConvocatoria } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Selección' };

/** Cuántas convocatorias se detallan en el panel de gestión. */
const MAXIMO_PANEL = 20;

/**
 * Selección.
 *
 * Dos pantallas en una, según quién mire. Para un tirador (o su tutor) es el
 * aviso más importante de toda la aplicación y se le da el sitio y el color que
 * le corresponde: el oro es exclusivo de aquí. Para el seleccionador y la
 * dirección técnica es, además, el panel de respuestas y de publicación.
 *
 * ---------------------------------------------------------------------------
 * EL ÁMBITO DEL SELECCIONADOR, QUE ES LO QUE FALTABA
 * ---------------------------------------------------------------------------
 * Con qué armas se abre el panel lo decide `armasDeArranque()` de
 * `src/lib/ambito.ts`: la misma función pura, con los mismos 23 casos probados,
 * que usan el calendario y la pantalla de tiradores. La regla **no se reescribe
 * aquí**; lo único que hace esta página es preguntarle y pasar el resultado.
 *
 * El arma de cada convocatoria sale de `armasPorConvocatoria()`, que la pide
 * como arma y no deshaciendo la etiqueta ya formateada de `CallUpDetail`.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const atletas = await getManagedAthletes(perfil.profileId);
  const mias = await listCallUpsForAthletes(atletas.map((a) => a.id));

  const esGestor = perfil.role === 'coach' || perfil.role === 'admin';
  const puedeGestionar = perfil.role === 'admin';

  let detalles: CallUpDetail[] = [];
  let eventos: EventoConvocable[] = [];
  let armas: Record<string, ('FLORETE' | 'ESPADA' | 'SABLE')[]> = {};

  if (esGestor) {
    const lista = await listCallUpsForAdmin();
    const cargadas = await Promise.all(
      lista.slice(0, MAXIMO_PANEL).map((c) => getCallUpDetail(c.id)),
    );
    detalles = cargadas.filter((d): d is CallUpDetail => d !== null);
    armas = await armasPorConvocatoria(detalles.map((d) => d.id));
    // La lista de eventos solo hace falta para el formulario de creación, que
    // solo ve la dirección técnica.
    if (puedeGestionar) eventos = await listEventosConvocables();
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const ahora = new Date();
  const activas = mias.filter((c) => c.eventEndDate >= hoy);
  const pasadas = mias.filter((c) => c.eventEndDate < hoy).reverse();

  const sinResponder = activas.filter((c) => c.status === 'pendiente').length;

  return (
    <div className="flex min-w-0 max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Selección</h1>
        <p className="text-sm text-muted-foreground">
          {contextoCabecera(perfil.role, atletas.length, sinResponder)}
        </p>
      </div>

      {atletas.length > 0 ? (
        activas.length > 0 ? (
          <div className="flex flex-col gap-3">
            {activas.map((c) => (
              <TarjetaConvocatoria
                key={c.id}
                convocatoria={c}
                plazo={calcularPlazo(c.respondBy, ahora)}
                mostrarNombre={atletas.length > 1}
              />
            ))}
          </div>
        ) : (
          <SinConvocatorias nombres={atletas.map((a) => a.fullName)} />
        )
      ) : null}

      {pasadas.length > 0 ? (
        <section className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2">
            <h2 className="text-xl">Convocatorias anteriores</h2>
            <p className="text-sm text-muted-foreground">
              {pasadas.length === 1
                ? '1 competición ya celebrada'
                : `${pasadas.length} competiciones ya celebradas`}
            </p>
          </div>
          <Historico convocatorias={pasadas} mostrarNombre={atletas.length > 1} />
        </section>
      ) : null}

      {esGestor ? (
        <PanelConvocatorias
          convocatorias={detalles}
          eventos={eventos}
          puedeGestionar={puedeGestionar}
          armasPorConvocatoria={armas}
          armasArranque={armasDeArranque(perfil)}
        />
      ) : null}
    </div>
  );
}

function contextoCabecera(
  rol: string,
  atletas: number,
  sinResponder: number,
): string {
  if (sinResponder > 0) {
    return sinResponder === 1
      ? '1 convocatoria pendiente de respuesta'
      : `${sinResponder} convocatorias pendientes de respuesta`;
  }
  if (atletas === 0 && (rol === 'coach' || rol === 'admin')) {
    return 'Convocatorias de la selección y respuestas';
  }
  return 'Al día: no tienes nada pendiente de responder';
}

/**
 * Estado vacío del tirador.
 *
 * Dice qué va a aparecer ahí y cuándo, que es lo único que le interesa a quien
 * entra y no encuentra nada. No se disculpa y no dice «no hay datos».
 *
 * La superficie es **sólida** con la textura teñida de oro (`fondo-panel
 * tinte-oro` sobre `bg-card`) y el filete de oro arriba. Antes era un recuadro
 * de línea discontinua, que se lee como «aquí falta algo» —un hueco de
 * plantilla— cuando lo que hay que decir es «esto es lo más importante que te
 * puede pasar, y todavía no ha pasado».
 *
 * Pero el filete va a UN píxel y sin el rótulo «Convocatoria de selección»
 * encima, al revés que una convocatoria de verdad, que lleva dos píxeles y el
 * rótulo. Con los dos iguales, la captura se leía como si hubiera una
 * convocatoria abierta hasta que uno llegaba al titular.
 */
function SinConvocatorias({ nombres }: { nombres: string[] }) {
  const quien =
    nombres.length === 1
      ? nombres[0]
      : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;

  return (
    <div className="fondo-panel tinte-oro flex max-w-2xl flex-col items-start gap-3 rounded-lg border-t border-gold/60 bg-card px-4 py-6 sm:px-5">
      <h2 className="flex items-center gap-2 text-xl">
        <Medal className="size-5 shrink-0 text-gold" aria-hidden />
        Ninguna convocatoria abierta
      </h2>
      <p className="medida text-sm text-muted-foreground">
        Cuando el seleccionador convoque a {quien} para un campeonato o una
        concentración, aparecerá aquí con el tipo de plaza, el PDF oficial y la
        fecha límite para contestar. También te llegará un correo el mismo día en
        que se publique.
      </p>
      <p className="medida text-sm text-muted-foreground">
        Las plazas por ranking salen de la clasificación de la temporada: en{' '}
        <Link href="/estado" className="underline underline-offset-2 transition-colors hover:text-foreground">
          Mi estado
        </Link>{' '}
        se ve en qué puesto vas y a cuántos puestos y puntos estás del corte.
      </p>
    </div>
  );
}
