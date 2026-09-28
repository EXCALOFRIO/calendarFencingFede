import { IdCard } from 'lucide-react';
import Link from 'next/link';
import { PanelEstado } from '@/components/estado/panel';
import { Button } from '@/components/ui/button';
import { requireProfile } from '@/lib/auth/session';
import { responderConvocatoria } from '@/lib/callups/actions';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { getMyStatus } from '@/lib/queries/my-status';
import { contarRankingOficial, getPuestosOficiales } from '@/lib/queries/ranking';
import {
  getCortesOficiales,
  getPruebasPropias,
  getPuestosDeTemporada,
  getPuntosPorPrueba,
} from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi estado' };

/**
 * La pantalla que responde «¿estoy dentro?», «¿cuánto me queda?» y «¿cómo voy?».
 *
 * Se carga entera en el servidor —listas oficiales, plazos, convocatorias y
 * ranking— y se le pasa al cliente de una vez: son unas decenas de filas por
 * cuenta y así cambiar de tirador no vuelve a la red.
 *
 * Lo que ya NO se carga: `requestEntry`. La acción sigue existiendo en
 * `src/lib/entries/` con su máquina de estados intacta —se oculta, no se
 * destruye— pero esta pantalla dejó de ser el sitio donde se tramita una
 * inscripción, así que no la importa.
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
  const [internos, oficiales, cortes, puntosPorPrueba, pruebas] =
    await Promise.all([
      getPuestosDeTemporada(ids),
      /*
        El ranking OFICIAL de la RFEE, que es distinto del cálculo interno y es
        el que la gente reconoce. Faltaba: un 3.º de España con 1.387,77 puntos
        estaba en la base y esta pantalla decía «sin puesto en el ranking»,
        porque solo miraba `ranking_snapshot`.
      */
      getPuestosOficiales(ids),
      /*
        A cuánto del corte de convocatoria. Es el hueco que tenía la pantalla:
        `/ranking` lo decía y aquí no, aunque esta es la que se abre para saber
        cómo vas. Usa `cutoffStatus` de `lib/ranking/compute`, la misma función
        y la misma normativa que la pantalla de ranking.
      */
      getCortesOficiales(ids),
      getPuntosPorPrueba(ids),
      /*
        Las dos primeras preguntas en una sola consulta: en qué pruebas figura
        en la LISTA OFICIAL —incluso si le inscribió otro— y cuánto queda de
        plazo en las que todavía le tocan.
      */
      getPruebasPropias(
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
      pruebas={pruebas}
      oficiales={oficiales}
      cortes={cortes}
      internos={internos}
      puntosPorPrueba={puntosPorPrueba}
      temporada={temporada?.label ?? null}
      // La fecha se decide en el servidor: el reloj del móvil puede estar en
      // otro huso y "hoy compites" no puede depender de eso.
      hoy={new Date().toISOString().slice(0, 10)}
      responderConvocatoria={responderConvocatoria}
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
            'que no hay competiciones ni plazos que seguir y el calendario no ' +
            'sabe cuál es tu arma.'
          : 'Esta pantalla sigue las competiciones de los tiradores de tu ' +
            'cuenta, y la tuya no gestiona ninguno. Lo de la federación ' +
            'entera está en el calendario, en tiradores y en el ranking.'}
      </p>
      {esPersonal ? (
        <p className="medida text-sm text-muted-foreground">
          Puedes unirla tú mismo:{' '}
          {oficial && oficial.tiradores > 0
            ? `búscate entre los ${oficial.tiradores} tiradores de la clasificación oficial de la RFEE`
            : 'búscate en la clasificación oficial de la RFEE'}{' '}
          y confírmalo. Tarda menos que escribir a nadie.
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
          <>
            <Button variant="outline" asChild>
              <Link href="/tiradores">Ver tiradores</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/ranking">Ver el ranking</Link>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
