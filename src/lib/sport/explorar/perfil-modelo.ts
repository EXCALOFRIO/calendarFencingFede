import type { FilaAgregadoEstadistico } from './estadisticas';
import type {
  FilaBalanceAsaltos,
  FilaClubPublicado,
  FilaMejorRanking,
  FilaRivalFrecuente,
} from './perfil-sql';
import type { Arma, FichaDeportiva } from './tipos';
import type {
  BalanceAsaltos,
  Medallero,
  PerfilDeportivo,
  PuestoRanking,
  TemporadaPerfil,
} from './tipos-perfil';

const ARMAS: readonly Arma[] = ['ESPADA', 'FLORETE', 'SABLE'];

/** Misma regla que la SQL de asaltos: FIE `2025` es la temporada `2024-2025`. */
export function temporadaDeportiva(valor: string): string {
  return /^\d{4}$/.test(valor) ? `${Number(valor) - 1}-${valor}` : valor;
}

/** `2024-2025` → `2024-25`; cualquier otra forma se enseña tal cual. */
export function etiquetaTemporadaDeportiva(valor: string): string {
  const m = /^(\d{4})-(\d{2})(\d{2})$/.exec(valor);
  return m ? `${m[1]}-${m[3]}` : valor;
}

/**
 * Skermo publica en `source_club` un código (`FED-M-C`, `100TO-C`), no un
 * nombre. Enseñarlo donde se espera un club parece un fallo, así que una
 * palabra suelta sin minúsculas ni espacios no se presenta como club.
 */
export function esCodigoClub(valor: string): boolean {
  const v = valor.trim();
  return !/\s/.test(v) && v === v.toUpperCase();
}

export function clubLegible(filas: readonly FilaClubPublicado[]): PerfilDeportivo['club'] {
  const fila = filas.find((f) => typeof f.club === 'string' && f.club.trim() && !esCodigoClub(f.club));
  return fila ? { nombre: fila.club.trim().replace(/\s+/g, ' '), fuente: fila.fuente, fecha: fila.fecha } : null;
}

/** Sólo con un único ID FIE confirmado en todo el grupo, y nunca para un posible menor. */
export function enlaceFie(filas: readonly { valor: string }[], esMenor: boolean): string | null {
  if (esMenor || filas.length !== 1 || !/^[1-9]\d{0,9}$/.test(String(filas[0].valor))) return null;
  return `https://fie.org/athletes/${filas[0].valor}`;
}

/** Porcentaje de victorias sobre asaltos decididos; sin asaltos decididos no hay porcentaje. */
export function porcentajeVictorias(b: Pick<BalanceAsaltos, 'victorias' | 'derrotas'> | null | undefined): number | null {
  if (!b) return null;
  const decididos = b.victorias + b.derrotas;
  return decididos > 0 ? Math.round((b.victorias / decididos) * 100) : null;
}

const n = (valor: unknown) => Number(valor ?? 0) || 0;

function medallero(r: Partial<FilaAgregadoEstadistico> | undefined): Medallero {
  return { oros: n(r?.victorias), platas: n(r?.platas), bronces: n(r?.bronces), finales: n(r?.finales) };
}

function balance(r: Partial<FilaBalanceAsaltos> | undefined): BalanceAsaltos {
  return {
    asaltos: n(r?.asaltos),
    victorias: n(r?.victorias),
    derrotas: n(r?.derrotas),
    empates: n(r?.empates),
    tocadosDados: n(r?.tocadosDados),
    tocadosRecibidos: n(r?.tocadosRecibidos),
  };
}

function sumarBalance(a: BalanceAsaltos, b: BalanceAsaltos): BalanceAsaltos {
  return {
    asaltos: a.asaltos + b.asaltos,
    victorias: a.victorias + b.victorias,
    derrotas: a.derrotas + b.derrotas,
    empates: a.empates + b.empates,
    tocadosDados: a.tocadosDados + b.tocadosDados,
    tocadosRecibidos: a.tocadosRecibidos + b.tocadosRecibidos,
  };
}

function minimo(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Una fila por temporada deportiva. Las filas FIE y RFEE de la misma
 * temporada se suman: cada prueba pertenece a una sola fila de origen, así
 * que no se cuenta dos veces.
 */
export function temporadasPerfil(
  estadisticas: readonly FilaAgregadoEstadistico[],
  asaltos: readonly FilaBalanceAsaltos[] | null,
): TemporadaPerfil[] {
  const mapa = new Map<string, TemporadaPerfil>();
  for (const r of estadisticas) {
    if (r.clase !== 'temporada' || !r.temporada) continue;
    const clave = temporadaDeportiva(r.temporada);
    const previa = mapa.get(clave);
    const m = medallero(r);
    const mejor = r.mejorPuesto == null ? null : Number(r.mejorPuesto);
    mapa.set(clave, previa
      ? {
          ...previa,
          pruebas: previa.pruebas + n(r.pruebas),
          conPuesto: previa.conPuesto + n(r.clasificaciones),
          mejorPuesto: minimo(previa.mejorPuesto, mejor),
          medallero: {
            oros: previa.medallero.oros + m.oros,
            platas: previa.medallero.platas + m.platas,
            bronces: previa.medallero.bronces + m.bronces,
            finales: previa.medallero.finales + m.finales,
          },
        }
      : { temporada: clave, pruebas: n(r.pruebas), conPuesto: n(r.clasificaciones), mejorPuesto: mejor, medallero: m, asaltos: null });
  }
  for (const a of asaltos ?? []) {
    if (a.clase !== 'temporada' || !a.temporada) continue;
    const clave = temporadaDeportiva(a.temporada);
    const previa = mapa.get(clave) ?? {
      temporada: clave, pruebas: 0, conPuesto: 0, mejorPuesto: null,
      medallero: { oros: 0, platas: 0, bronces: 0, finales: 0 }, asaltos: null,
    };
    const b = balance(a);
    mapa.set(clave, { ...previa, asaltos: previa.asaltos ? sumarBalance(previa.asaltos, b) : b });
  }
  return [...mapa.values()].sort((x, y) => y.temporada.localeCompare(x.temporada));
}

function puestoRanking(r: {
  puesto: number; totalPublicado: number | null; fuente: string; temporada: string; arma: string;
  categoria: { codigo: string; raw: string | null };
}): PuestoRanking | null {
  if (!ARMAS.includes(r.arma as Arma) || !(Number(r.puesto) > 0)) return null;
  return {
    puesto: Number(r.puesto),
    totalPublicado: r.totalPublicado === null ? null : Number(r.totalPublicado),
    fuente: r.fuente,
    temporada: r.temporada,
    arma: r.arma as Arma,
    categoria: r.categoria,
  };
}

export type FilasPerfil = {
  estadisticas: readonly FilaAgregadoEstadistico[];
  /** `null` = la consulta falló. */
  asaltos: readonly FilaBalanceAsaltos[] | null;
  rivales: readonly FilaRivalFrecuente[] | null;
  clubes: readonly FilaClubPublicado[];
  idsFie: readonly { valor: string }[];
  mejorRanking: readonly FilaMejorRanking[];
};

export function construirPerfil(
  filas: FilasPerfil,
  ficha: Pick<FichaDeportiva, 'esMenor' | 'rankingOficial'>,
): PerfilDeportivo {
  const total = filas.estadisticas.find((r) => r.clase === 'total');
  const porArma = new Map<Arma, number>();
  for (const r of filas.estadisticas) {
    if (r.clase === 'categoria' && r.arma && ARMAS.includes(r.arma)) {
      porArma.set(r.arma, (porArma.get(r.arma) ?? 0) + n(r.pruebas));
    }
  }

  const fases = filas.asaltos?.filter((a) => a.clase === 'fase') ?? [];
  const actual = ficha.rankingOficial.entradas
    .filter((e) => e.puesto !== null && e.formato === 'INDIVIDUAL')
    .sort((a, b) => (a.puesto ?? 0) - (b.puesto ?? 0))[0];
  const [mejor] = filas.mejorRanking;

  return {
    armas: [...porArma.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([arma]) => arma),
    club: clubLegible(filas.clubes),
    enlaceFie: enlaceFie(filas.idsFie, ficha.esMenor),
    resumen: {
      pruebas: n(total?.pruebas),
      conPuesto: n(total?.clasificaciones),
      mejorPuesto: total?.mejorPuesto == null ? null : Number(total.mejorPuesto),
      ...medallero(total),
    },
    asaltos: filas.asaltos
      ? {
          total: balance(filas.asaltos.find((a) => a.clase === 'total')),
          poule: balance(fases.find((a) => a.fase === 'POULE')),
          eliminacion: balance(fases.find((a) => a.fase === 'TABLEAU')),
        }
      : null,
    temporadas: temporadasPerfil(filas.estadisticas, filas.asaltos),
    rivales: filas.rivales
      ? filas.rivales.map((r) => ({
          id: r.id,
          nombre: r.nombreRival,
          pais: r.paisRival,
          asaltos: n(r.asaltos),
          victorias: n(r.victorias),
          derrotas: n(r.derrotas),
          ultimo: { fecha: r.ultimaFecha, favor: n(r.ultimoFavor), contra: n(r.ultimoContra), torneo: r.ultimoTorneo },
        }))
      : null,
    ranking: {
      actual: actual
        ? puestoRanking({
            puesto: actual.puesto ?? 0,
            totalPublicado: actual.totalPublicado,
            fuente: actual.fuente,
            temporada: actual.temporada,
            arma: actual.arma,
            categoria: actual.categoria,
          })
        : null,
      mejor: mejor
        ? puestoRanking({
            puesto: mejor.puesto,
            totalPublicado: mejor.total,
            fuente: mejor.fuente,
            temporada: mejor.temporada,
            arma: mejor.arma,
            categoria: { codigo: mejor.categoria, raw: mejor.categoriaRaw },
          })
        : null,
    },
  };
}
