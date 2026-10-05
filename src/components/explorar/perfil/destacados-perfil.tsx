import { fuenteRanking } from '@/lib/sport/explorar/etiquetas';
import { etiquetaTemporadaDeportiva, porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import type { EstadisticaPorTipo } from '@/lib/sport/explorar/tipos';
import type { PerfilDeportivo, PuestoRanking, TemporadaPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';
import { ANILLO } from '../avatar-anillo';

export type Destacado = {
  clave: string;
  cifra: string;
  rotulo: string;
  detalle?: string;
  /** Con anillo carmesí: los hitos (oros, títulos). El resto lleva un filete. */
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

/** Rótulo corto: bajo un disco de 64 px no cabe «FIE (ranking mundial)». */
function rotuloRanking(fuente: string): string {
  if (fuente === 'fie_tiradores') return 'Ranking FIE';
  if (fuente === 'skermo_ranking') return 'Ranking RFEE';
  return fuenteRanking(fuente);
}

function modalidad(r: PuestoRanking): string {
  const categoria = CATEGORY_LABEL[r.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? r.categoria.codigo;
  return `${WEAPON_LABEL[r.arma]} ${categoria.toLowerCase()}`;
}

/** Hitos de la ficha, de más a menos llamativo. Sólo se enseña lo que está importado. */
export function destacadosPerfil(perfil: PerfilDeportivo, porTipo: readonly EstadisticaPorTipo[]): Destacado[] {
  const lista: Destacado[] = [];
  const { oros, platas, bronces } = perfil.resumen;
  if (oros > 0) lista.push({ clave: 'oros', cifra: String(oros), rotulo: oros === 1 ? 'Oro' : 'Oros', resaltado: true });
  if (platas > 0) lista.push({ clave: 'platas', cifra: String(platas), rotulo: platas === 1 ? 'Plata' : 'Platas' });
  if (bronces > 0) lista.push({ clave: 'bronces', cifra: String(bronces), rotulo: bronces === 1 ? 'Bronce' : 'Bronces' });

  const espana = porTipo.find((e) => e.tipo === 'CTO_ESPANA');
  if (espana && espana.victorias > 0) {
    lista.push({
      clave: 'espana', cifra: String(espana.victorias), resaltado: true,
      rotulo: espana.victorias === 1 ? 'Campeón de España' : 'Títulos de España',
    });
  } else if (espana && espana.podios > 0) {
    lista.push({ clave: 'espana', cifra: String(espana.podios), rotulo: 'Podios en el Cto. de España' });
  } else if (espana && espana.mejorPuesto !== null) {
    lista.push({ clave: 'espana', cifra: `${espana.mejorPuesto}º`, rotulo: 'Mejor en el Cto. de España' });
  }

  const { actual, mejor } = perfil.ranking;
  if (actual) {
    lista.push({ clave: 'ranking', cifra: `${actual.puesto}º`, rotulo: rotuloRanking(actual.fuente), detalle: modalidad(actual) });
  }
  if (mejor && (!actual || mejor.puesto < actual.puesto)) {
    lista.push({ clave: 'mejor-ranking', cifra: `${mejor.puesto}º`, rotulo: 'Mejor ranking', detalle: etiquetaTemporada(mejor.temporada) });
  }

  const temporada = mejorTemporada(perfil.temporadas);
  if (temporada) {
    const m = medallasDe(temporada);
    lista.push({
      clave: 'temporada',
      cifra: m > 0 ? String(m) : `${temporada.mejorPuesto}º`,
      rotulo: 'Mejor temporada',
      detalle: `${m > 0 ? (m === 1 ? 'Medalla' : 'Medallas') : 'Mejor puesto'} en ${etiquetaTemporadaDeportiva(temporada.temporada)}`,
    });
  }

  const pct = porcentajeVictorias(perfil.asaltos?.total);
  if (pct !== null) lista.push({ clave: 'pct', cifra: `${pct}%`, rotulo: 'Asaltos ganados' });
  return lista;
}

/**
 * Fila de hitos con forma de historias: discos con una cifra y su rótulo
 * debajo, que se desplazan en horizontal en el móvil. No son botones: no
 * llevan a ningún sitio, así que no compiten con las acciones.
 */
export function DestacadosPerfil({ perfil, porTipo }: { perfil: PerfilDeportivo; porTipo: readonly EstadisticaPorTipo[] }) {
  const lista = destacadosPerfil(perfil, porTipo);
  if (lista.length === 0) return null;
  return (
    <section aria-labelledby="ficha-destacados" className="min-w-0">
      <h2 id="ficha-destacados" className="sr-only">Destacados</h2>
      <ul className="flex min-w-0 snap-x gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] sm:gap-5 sm:px-6">
        {lista.map((d) => (
          <li key={d.clave} className="flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 text-center sm:w-24">
            <span className={cn('inline-flex', d.resaltado ? ANILLO : 'rounded-full bg-filete-alto p-[2px]')}>
              <span className="inline-flex size-16 items-center justify-center rounded-full border-2 border-background bg-secondary sm:size-[4.5rem]">
                <span className={cn('cifra leading-none', d.cifra.length > 3 ? 'text-xl' : 'text-2xl sm:text-3xl')}>{d.cifra}</span>
              </span>
            </span>
            <span className="text-xs leading-tight font-medium break-words">{d.rotulo}</span>
            {d.detalle ? <span className="text-[0.6875rem] leading-tight text-muted-foreground break-words">{d.detalle}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
