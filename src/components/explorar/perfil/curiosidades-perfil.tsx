import {
  Flame,
  Mountain,
  Scale,
  ShieldHalf,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type {
  ClaveCuriosidad,
  Curiosidad,
  EstadisticasRivales,
  RegistroAsaltos,
} from '@/lib/sport/explorar/tipos-social';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn, titular } from '@/lib/utils';
import { AvatarAnillo } from '../avatar-anillo';
import { Aclaracion, Bloque, Nota, fechaLegible, type Nivel } from '../piezas';
import { Cifra, Metrica, SinDato } from './piezas-perfil';

const ICONOS: Record<ClaveCuriosidad, LucideIcon> = {
  rivalMasHabitual: Users,
  masTocadosDados: Target,
  masTocadosPorAsalto: Zap,
  masTocadosRecibidos: ShieldHalf,
  rivalMasDificil: Mountain,
  masVictoriasContra: Trophy,
  duelosMasAjustados: Scale,
  mejorRacha: Flame,
  mayorVictoria: Trophy,
};

const decimal = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
const pct = (p: number | null) => (p === null ? null : Math.round(p * 100));

/** Cifra principal y su unidad, escrita: la cifra nunca va sola. */
export function cifraCuriosidad(c: Curiosidad): { cifra: string; unidad: string } {
  const n = c.valor;
  const uno = n === 1;
  switch (c.clave) {
    case 'rivalMasHabitual':
      return { cifra: String(n), unidad: uno ? 'asalto' : 'asaltos' };
    case 'masTocadosDados':
      return { cifra: String(n), unidad: uno ? 'tocado dado' : 'tocados dados' };
    case 'masTocadosPorAsalto':
      return { cifra: decimal(n), unidad: 'tocados por asalto' };
    case 'masTocadosRecibidos':
      return { cifra: String(n), unidad: uno ? 'tocado recibido' : 'tocados recibidos' };
    case 'rivalMasDificil':
      return { cifra: String(n), unidad: uno ? 'derrota' : 'derrotas' };
    case 'masVictoriasContra':
      return { cifra: String(n), unidad: uno ? 'victoria' : 'victorias' };
    case 'duelosMasAjustados':
      return { cifra: String(n), unidad: uno ? 'asalto por un tocado' : 'asaltos por un tocado' };
    case 'mejorRacha':
      return { cifra: String(n), unidad: uno ? 'victoria seguida' : 'victorias seguidas' };
    case 'mayorVictoria':
      return c.marcador
        ? { cifra: `${c.marcador.favor}–${c.marcador.contra}`, unidad: 'el asalto ganado con más diferencia' }
        : { cifra: `+${n}`, unidad: 'tocados de diferencia' };
  }
}

/**
 * La frase del modelo lleva el nombre tal y como lo publica la fuente
 * («GARCIA PEREZ Lucia»); en pantalla va como en el resto de la ficha.
 */
export function fraseCuriosidad(c: Curiosidad): string {
  let frase = c.descripcion;
  if (c.rival.nombre) frase = frase.split(c.rival.nombre).join(nombreVisible(c.rival.nombre) || c.rival.nombre);
  if (c.marcador?.torneo) frase = frase.split(c.marcador.torneo).join(titular(c.marcador.torneo));
  return frase.replace(/(\d+)-(\d+)/g, '$1–$2');
}

/** Barra de victorias frente a derrotas; decorativa, el balance va escrito al lado. */
function BarraBalance({ victorias, derrotas }: { victorias: number; derrotas: number }) {
  const decididos = victorias + derrotas;
  const ancho = decididos > 0 ? Math.round((victorias / decididos) * 100) : 0;
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-full overflow-hidden rounded-full bg-filete-alto">
      <span className="absolute inset-y-0 left-0 rounded-full bg-primary-text" style={{ width: `${ancho}%` }} />
    </span>
  );
}

function TarjetaCuriosidad({ personaId, c, nivel }: { personaId: string; c: Curiosidad; nivel: Nivel }) {
  const Titulo = nivel === 'pagina' ? 'h3' : 'h4';
  const Icono = ICONOS[c.clave];
  const nombre = nombreVisible(c.rival.nombre) || c.rival.nombre;
  const { cifra, unidad } = cifraCuriosidad(c);
  const b = c.balance;
  return (
    <li
      className="flex w-[17.5rem] min-w-0 shrink-0 snap-start flex-col gap-3 rounded-md border bg-card px-4 py-4 sm:w-auto sm:rounded-none sm:border-0 sm:px-5"
      data-curiosidad={c.clave}
    >
      <span className="flex items-center gap-2.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-marcado text-primary-text">
          <Icono className="size-4.5" aria-hidden />
        </span>
        <Titulo className="font-sans text-sm leading-tight font-semibold">{c.etiqueta}</Titulo>
      </span>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="cifra text-4xl leading-none whitespace-nowrap">{cifra}</span>
        <span className="text-xs text-muted-foreground">{unidad}</span>
      </p>
      <p className="text-sm leading-snug break-words">{fraseCuriosidad(c)}</p>
      {c.marcador ? (
        <p className="-mt-1 text-xs text-muted-foreground">
          {c.marcador.fecha ? fechaLegible(c.marcador.fecha) : 'Fecha no publicada'}
        </p>
      ) : null}
      <div className="mt-auto flex min-w-0 flex-col gap-2 border-t pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={rutaFicha(c.rival.id)}
            prefetch={false}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <AvatarAnillo nombre={nombre} tamano="sm" apagado />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{nombre}</span>
              {c.rival.pais ? <BanderaPais pais={c.rival.pais} /> : null}
            </span>
          </Link>
          <Link
            href={construirUrlCaraACara(personaId, { rival: c.rival.id })}
            prefetch={false}
            aria-label={`Cara a cara con ${nombre}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm text-primary-text hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Swords className="size-4" aria-hidden />
            Cara a cara
          </Link>
        </div>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span>
              <strong className="cifra text-base text-foreground">{b.victorias}–{b.derrotas}</strong>{' '}
              en {b.asaltos === 1 ? 'el asalto' : `${b.asaltos} asaltos`}
            </span>
            {b.empates > 0 ? <span>{b.empates} sin decidir</span> : null}
          </span>
          <BarraBalance victorias={b.victorias} derrotas={b.derrotas} />
        </span>
      </div>
    </li>
  );
}

/**
 * Curiosidades del historial de asaltos: el rival más habitual, el duelo más
 * ajustado, la mejor racha… Cada tarjeta enlaza a la ficha del rival y al cara
 * a cara de la pareja. Textos neutros: describen el duelo, no juzgan a nadie.
 */
export function CuriosidadesPerfil({
  personaId,
  stats,
  nivel,
}: {
  personaId: string;
  stats: EstadisticasRivales;
  nivel: Nivel;
}) {
  if (stats.curiosidades.length === 0) return null;
  return (
    <Bloque id="ficha-curiosidades" titulo="Curiosidades" nivel={nivel}>
      <ul
        className={cn(
          // En móvil, carrusel horizontal; desde `sm`, rejilla con filetes.
          '-mx-4 flex min-w-0 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2',
          'sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-px sm:overflow-visible sm:border-y sm:bg-border sm:px-0 sm:pb-0 lg:grid-cols-3',
        )}
        aria-label="Curiosidades de sus asaltos"
      >
        {stats.curiosidades.map((c) => <TarjetaCuriosidad key={c.clave} personaId={personaId} c={c} nivel={nivel} />)}
      </ul>
      <Aclaracion titulo="De dónde salen las curiosidades">
        <Nota>
          Se calculan con los asaltos individuales importados frente a rivales identificados
          ({stats.rivalesDistintos} {stats.rivalesDistintos === 1 ? 'rival distinto' : 'rivales distintos'}).
          Las que comparan proporciones piden al menos tres asaltos con el mismo rival. Un asalto
          con marcador igualado no cuenta como victoria ni como derrota.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}

function RegistroFase({ etiqueta, r }: { etiqueta: string; r: RegistroAsaltos }) {
  const p = pct(r.porcentajeVictorias);
  return (
    <Metrica
      etiqueta={etiqueta}
      detalle={r.asaltos > 0 ? `${r.asaltos} ${r.asaltos === 1 ? 'asalto' : 'asaltos'}${p !== null ? `, ${p}% ganados` : ''}` : undefined}
    >
      {r.asaltos === 0 ? <SinDato>Sin asaltos importados</SinDato> : (
        <Cifra className={cn('text-4xl sm:text-5xl')}>{r.victorias}–{r.derrotas}</Cifra>
      )}
    </Metrica>
  );
}

/** Poule frente a eliminación directa, y la «sangre fría»: los asaltos decididos por un tocado. */
export function BalanceFasesRivales({ stats, nivel }: { stats: EstadisticasRivales; nivel: Nivel }) {
  const Titulo = nivel === 'pagina' ? 'h2' : 'h3';
  const sf = stats.sangreFria;
  const p = pct(sf.porcentaje);
  return (
    <section aria-labelledby="ficha-fases" className="min-w-0">
      <Titulo id="ficha-fases" className="sr-only">Balance por fase</Titulo>
      <dl className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-3">
        <RegistroFase etiqueta="Poule" r={stats.poule} />
        <RegistroFase etiqueta="Eliminación directa" r={stats.eliminacion} />
        <Metrica
          etiqueta="Sangre fría"
          className="col-span-2 sm:col-span-1"
          detalle={sf.asaltos > 0
            ? `Ganados ${sf.victorias} de ${sf.asaltos} ${sf.asaltos === 1 ? 'asalto decidido' : 'asaltos decididos'} por un tocado`
            : 'Asaltos decididos por un tocado (5–4, 15–14…)'}
        >
          {sf.asaltos === 0 || p === null ? <SinDato>Ningún asalto decidido por un tocado</SinDato> : (
            <Cifra>{p}<span className="text-2xl">%</span></Cifra>
          )}
        </Metrica>
      </dl>
    </section>
  );
}
