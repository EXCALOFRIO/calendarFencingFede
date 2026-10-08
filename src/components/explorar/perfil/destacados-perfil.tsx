import { Award, Crown, Globe2, TrendingUp, type LucideIcon } from 'lucide-react';
import { temporadaCorta } from '@/lib/ranking/url-nacional';
import { porcentajeVictorias, temporadaDeportiva } from '@/lib/sport/explorar/perfil-modelo';
import { CONTORNO_MEDALLA, categoriaVisible } from '@/lib/sport/explorar/presentacion';
import type { EstadisticaPorTipo } from '@/lib/sport/explorar/tipos';
import type { PerfilDeportivo, PuestoRanking, TemporadaPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { WEAPON_LABEL, cn } from '@/lib/utils';

export type Destacado = {
  clave: string;
  cifra: string;
  rotulo: string;
  detalle?: string;
  /** Los hitos (títulos) llevan el tono dorado. */
  resaltado?: boolean;
};

function medallasDe(t: TemporadaPerfil): number {
  return t.medallero.oros + t.medallero.platas + t.medallero.bronces;
}

/**
 * La mejor temporada: más medallas, luego mejor puesto y luego más asaltos
 * ganados. Sin medallas ni puesto no hay nada que destacar.
 */
export function mejorTemporada(temporadas: readonly TemporadaPerfil[]): TemporadaPerfil | null {
  const candidatas = temporadas.filter((t) => medallasDe(t) > 0 || t.mejorPuesto !== null);
  if (candidatas.length < 2) return null;
  return [...candidatas].sort((a, b) =>
    medallasDe(b) - medallasDe(a)
    || (a.mejorPuesto ?? Infinity) - (b.mejorPuesto ?? Infinity)
    || (porcentajeVictorias(b.asaltos) ?? -1) - (porcentajeVictorias(a.asaltos) ?? -1))[0];
}

/** Rótulo corto de la lista oficial: «Mundial» es el Campeonato del Mundo, no el ranking de la FIE. */
export function rotuloRanking(fuente: string): string {
  if (fuente === 'fie_tiradores') return 'Ranking internacional';
  if (fuente === 'skermo_ranking') return 'Ranking nacional';
  return 'Ranking';
}

function modalidad(r: PuestoRanking): string {
  return `${WEAPON_LABEL[r.arma]} ${categoriaVisible(r.categoria.codigo).toLowerCase()}`;
}

/**
 * Hitos de la ficha, de más a menos llamativo. Las medallas no van aquí: la
 * cabecera ya las enseña con su color. Los títulos de España salen de la
 * misma lectura por prueba que la lista (tipo por nombre y calendario); el
 * desglose antiguo por tipo documentado sólo se usa si esa lectura falta.
 */
export function destacadosPerfil(perfil: PerfilDeportivo, porTipo: readonly EstadisticaPorTipo[] = []): Destacado[] {
  const lista: Destacado[] = [];

  const espanaAmbito = perfil.ambito?.porTipo.find((t) => t.clave === 'CTO_ESPANA');
  const viejo = porTipo.find((e) => e.tipo === 'CTO_ESPANA');
  const espana = espanaAmbito
    ? { titulos: espanaAmbito.oros, podios: espanaAmbito.medallas, mejor: espanaAmbito.mejorPuesto }
    : viejo ? { titulos: viejo.victorias, podios: viejo.podios, mejor: viejo.mejorPuesto } : null;
  if (espana && espana.titulos > 0) {
    lista.push({
      clave: 'espana', cifra: String(espana.titulos), resaltado: true,
      rotulo: espana.titulos === 1 ? 'Campeón de España' : 'Títulos de España',
    });
  } else if (espana && espana.podios > 0) {
    lista.push({ clave: 'espana', cifra: String(espana.podios), rotulo: espana.podios === 1 ? 'Podio en el Cto. de España' : 'Podios en el Cto. de España' });
  } else if (espana && espana.mejor !== null) {
    lista.push({ clave: 'espana', cifra: `${espana.mejor}º`, rotulo: 'Mejor Cto. de España' });
  }

  const { actual, mejor } = perfil.ranking;
  if (actual) {
    lista.push({ clave: 'ranking', cifra: `${actual.puesto}º`, rotulo: rotuloRanking(actual.fuente), detalle: modalidad(actual) });
  }
  if (mejor && (!actual || mejor.puesto < actual.puesto)) {
    lista.push({ clave: 'mejor-ranking', cifra: `${mejor.puesto}º`, rotulo: 'Mejor ranking', detalle: etiquetaTemporada(mejor.temporada) });
  }

  const internacional = perfil.ambito?.internacional;
  if (internacional && internacional.competiciones > 0 && internacional.mejorPuesto !== null && perfil.ambito!.nacional.competiciones > 0) {
    lista.push({
      clave: 'internacional', cifra: `${internacional.mejorPuesto}º`, rotulo: 'Mejor intl.',
      detalle: `${internacional.competiciones} ${internacional.competiciones === 1 ? 'prueba' : 'pruebas'}`,
    });
  }

  const temporada = mejorTemporada(perfil.temporadas);
  if (temporada) {
    const m = medallasDe(temporada);
    lista.push({
      clave: 'temporada',
      // «20-21»: «2020-21» no cabe en la baldosa a 320 px.
      cifra: temporadaCorta(temporadaDeportiva(temporada.temporada)),
      rotulo: 'Mejor temporada',
      detalle: m > 0 ? `${m} ${m === 1 ? 'medalla' : 'medallas'}` : `Mejor puesto ${temporada.mejorPuesto}º`,
    });
  }
  return lista;
}

const ICONO: Record<string, LucideIcon> = {
  espana: Crown,
  ranking: TrendingUp,
  'mejor-ranking': Award,
  internacional: Globe2,
  temporada: Award,
};

/** Hitos en tarjetas pequeñas que se reparten en rejilla: nada se desplaza en horizontal. */
export function DestacadosPerfil({ perfil, porTipo }: { perfil: PerfilDeportivo; porTipo?: readonly EstadisticaPorTipo[] }) {
  const lista = destacadosPerfil(perfil, porTipo).slice(0, 4);
  if (lista.length === 0) return null;
  return (
    <section aria-labelledby="ficha-destacados" className="min-w-0">
      <h2 id="ficha-destacados" className="sr-only">Destacados</h2>
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {lista.map((d) => {
          const Icono = ICONO[d.clave] ?? Award;
          return (
            <li
              key={d.clave}
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-3',
                d.resaltado && CONTORNO_MEDALLA.oro,
              )}
            >
              <Icono className={cn('hidden size-4 shrink-0 sm:block', !d.resaltado && 'text-muted-foreground')} aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="cifra truncate text-2xl leading-none">{d.cifra}</span>
                <span className="truncate text-xs leading-tight font-medium text-foreground">{d.rotulo}</span>
                {d.detalle ? <span className="truncate text-xs leading-tight text-muted-foreground">{d.detalle}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
