import { IdCard } from 'lucide-react';
import Link from 'next/link';
import { PanelEstado } from '@/components/estado/panel';
import { Button } from '@/components/ui/button';
import { requireProfile } from '@/lib/auth/session';
import { responderConvocatoria } from '@/lib/callups/actions';
import { requestEntry } from '@/lib/entries/actions';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { getMyStatus } from '@/lib/queries/my-status';
import { contarRankingOficial, getPuestosOficiales } from '@/lib/queries/ranking';
import {
  getCompeticionesElegibles,
  getPuestosDeTemporada,
  getPuntosPorPrueba,
} from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi estado' };

/**
 * La pantalla que responde "¿cómo voy?".
 *
 * Se carga entera en el servidor —inscripciones, plazos, convocatorias y
 * ranking— y se le pasa al cliente de una vez: son unas decenas de filas por
 * cuenta y así cambiar de tirador no vuelve a la red.
 */
export default async function Pagina() {
  const perfil = await requireProfile();

  const [estado, temporada] = await Promise.all([
    getMyStatus(perfil.profileId),
    getCurrentSeason(),
  ]);

  if (estado.athletes.length === 0) {
    return <SinTiradores rol={perfil.role} />;
  }

  const ids = estado.athletes.map((a) => a.id);
  const [puestos, oficiales, puntosPorPrueba, elegibles] = await Promise.all([
    getPuestosDeTemporada(ids),
    /*
      El ranking OFICIAL de la RFEE, que es distinto del cálculo interno y es
      el que la gente reconoce. Faltaba: un 3.º de España con 1.387,77 puntos
      estaba en la base y esta pantalla decía «sin puesto en el ranking»,
      porque solo miraba `ranking_snapshot`. Cierto respecto al cálculo propio
      y completamente engañoso respecto a la realidad.
    */
    getPuestosOficiales(ids),
    getPuntosPorPrueba(ids),
    /*
      En qué NO está y todavía podría estar. La elegibilidad sale de lo que
      `getMyStatus` ya derivó con la tabla de categorías de la temporada, así
      que la regla es exactamente la misma que aplica la ficha del calendario
      al decidir si el botón de inscribirse está activo.
    */
    getCompeticionesElegibles(
      estado.athletes.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        gender: a.gender,
        weapons: a.weapons,
        eligibleCategories: a.eligibleCategories,
      })),
    ),
  ]);

  return (
    <PanelEstado
      estado={estado}
      puestos={puestos}
      oficiales={oficiales}
      puntosPorPrueba={puntosPorPrueba}
      elegibles={elegibles}
      temporada={temporada?.label ?? null}
      // La fecha se decide en el servidor: el reloj del móvil puede estar en
      // otro huso y "hoy compites" no puede depender de eso.
      hoy={new Date().toISOString().slice(0, 10)}
      responderConvocatoria={responderConvocatoria}
      solicitarInscripcion={requestEntry}
    />
  );
}

/**
 * Sin tiradores vinculados no hay estado que enseñar.
 *
 * Y para un tirador o un tutor esto ya no es un callejón: la ficha se la puede
 * crear él mismo desde `/alta`, buscándose en el ranking oficial de la RFEE. Es
 * la puerta de entrada principal a esa pantalla, porque este es el sitio donde
 * el hueco se nota.
 */
async function SinTiradores({ rol }: { rol: string }) {
  const esPersonal = rol === 'athlete' || rol === 'guardian';
  const oficial = esPersonal ? await contarRankingOficial() : null;

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl sm:text-3xl">Mi estado</h1>
      <p className="medida text-sm text-muted-foreground">
        {esPersonal
          ? 'Tu cuenta todavía no está unida a ninguna ficha de tirador, así ' +
            'que no hay inscripciones ni plazos que seguir y el calendario no ' +
            'sabe cuál es tu arma.'
          : 'Esta pantalla sigue las inscripciones de los tiradores de tu ' +
            'cuenta, y la tuya no gestiona ninguno. Si buscas las de toda la ' +
            'federación, están en el panel de inscripciones.'}
      </p>
      {esPersonal ? (
        <p className="medida text-sm text-muted-foreground">
          Puedes unirla tú mismo:{' '}
          {oficial && oficial.tiradores > 0
            ? `búscate entre los ${oficial.tiradores} tiradores de la clasificación oficial de la RFEE`
            : 'búscate en la clasificación oficial de la RFEE'}{' '}
          y confírmalo con tu número de licencia. Tarda menos que escribir a
          nadie.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {esPersonal ? (
          <Button asChild>
            <Link href="/alta">
              <IdCard aria-hidden />
              Vincular mi ficha
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <Link href="/">Ver el calendario</Link>
        </Button>
        {!esPersonal ? (
          <Button variant="outline" asChild>
            <Link href="/tiradores">Ver tiradores</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
