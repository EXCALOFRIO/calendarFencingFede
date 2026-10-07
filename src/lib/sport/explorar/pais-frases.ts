import type { DueloPaises, FichaPais } from './pais';
import { ETIQUETA_CATEGORIA, type FiltrosDuelo, type FiltrosPais } from './pais-url';

/**
 * Frases cortas que cuentan los datos de una ficha de país en lenguaje
 * sencillo («España ganó 12 medallas en M20 espada desde 2015»). Puras: la
 * página las calcula a partir del DTO, que es el que se cachea.
 */

/** «1.234» también con cuatro cifras (es-ES no agrupa los miles por debajo de 10.000). */
export function cifra(valor: number): string {
  return String(Math.round(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function porcentaje(a: number, total: number): string {
  return total > 0 ? `${Math.round((a / total) * 100)} %` : '';
}

const plural = (n: number, uno: string, varios: string) => `${cifra(n)} ${n === 1 ? uno : varios}`;

/** «2023-24» de «2023-2024». */
export function temporadaCorta(t: string): string {
  const m = /^(\d{4})-\d{2}(\d{2})$/.exec(t);
  return m ? `${m[1]}-${m[2]}` : t;
}

/** Año en que acaba una temporada («2015» de «2014-2015»), como cuenta la FIE. */
const anioDe = (t: string) => /^\d{4}-(\d{4})$/.exec(t)?.[1] ?? t;

const ARMA_MINUSCULA: Record<string, string> = { ESPADA: 'espada', FLORETE: 'florete', SABLE: 'sable' };

/**
 * «en M20 espada masculina», «en florete femenino», «en veteranos», «por
 * equipos»… El adjetivo concuerda con el arma (la espada, el florete).
 */
export function contexto(f: Partial<FiltrosPais>): string {
  const femenina = f.arma === 'ESPADA';
  const partes: string[] = [];
  if (f.categoria && f.categoria !== 'ABS') partes.push(f.categoria === 'VET' ? 'veteranos' : ETIQUETA_CATEGORIA[f.categoria] ?? f.categoria);
  if (f.arma) partes.push(ARMA_MINUSCULA[f.arma] ?? f.arma.toLowerCase());
  if (f.genero) {
    const m = f.genero === 'M';
    partes.push(f.arma ? (femenina ? (m ? 'masculina' : 'femenina') : (m ? 'masculino' : 'femenino')) : (m ? 'masculino' : 'femenino'));
  }
  if (f.categoria === 'ABS') partes.push(f.arma ? (femenina ? 'absoluta' : 'absoluto') : 'absoluto');
  let texto = partes.length ? ` en ${partes.join(' ')}` : '';
  if (f.modalidad === 'equipos') texto += ' por equipos';
  if (f.modalidad === 'individual') texto += ' en individual';
  return texto;
}

export function frasesPais(nombre: string, ficha: FichaPais, f: FiltrosPais): string[] {
  const t = ficha.total;
  if (!t || t.resultados === 0) return [];
  const ctx = contexto(f);
  const frases: string[] = [];
  const medallas = t.oros + t.platas + t.bronces;
  const conMedalla = ficha.temporadas.filter((s) => s.oros + s.platas + s.bronces > 0);
  if (medallas > 0) {
    const desde = conMedalla[0] ? ` desde ${anioDe(conMedalla[0].temporada)}` : '';
    const oros = t.oros > 0 ? `, ${plural(t.oros, 'de oro', 'de oro')}` : '';
    frases.push(`${nombre} ganó ${plural(medallas, 'medalla', 'medallas')}${ctx}${desde}${oros}.`);
  } else if (t.mejor !== null) {
    frases.push(`${nombre} aún no tiene medallas${ctx}; su mejor puesto es el ${t.mejor}.º.`);
  }
  const mejor = [...conMedalla].sort((a, b) =>
    (b.oros + b.platas + b.bronces) - (a.oros + a.platas + a.bronces) || b.oros - a.oros || b.temporada.localeCompare(a.temporada))[0];
  if (mejor && conMedalla.length > 1) {
    frases.push(`Su mejor temporada fue la ${temporadaCorta(mejor.temporada)}, con ${plural(mejor.oros + mejor.platas + mejor.bronces, 'medalla', 'medallas')}.`);
  }
  if (t.tiradores > 0) {
    frases.push(`${plural(t.tiradores, 'tirador ha', 'tiradores han')} competido por ${nombre}${f.modalidad === 'equipos' ? '' : ctx} en ${plural(t.pruebas, 'prueba', 'pruebas')}.`);
  } else if (t.finales > 0) {
    frases.push(`Llegó ${plural(t.finales, 'vez', 'veces')} a los 8 primeros.`);
  }
  return frases;
}

export function frasesDuelo(nombre: string, nombreRival: string, d: DueloPaises, f: FiltrosDuelo): string[] {
  const frases: string[] = [];
  const ctx = contexto({ ...f, modalidad: '' });
  const enTemporada = f.temporada ? ` en la temporada ${temporadaCorta(f.temporada)}` : '';
  const { individual: i, equipos: e } = d;
  if (i.asaltos > 0 && f.modalidad !== 'equipos') {
    frases.push(`${nombre} ganó ${cifra(i.victorias)} de ${plural(i.asaltos, 'asalto', 'asaltos')} contra ${nombreRival}${ctx}${enTemporada} (${porcentaje(i.victorias, i.victorias + i.derrotas)}).`);
  }
  if (e.asaltos > 0 && f.modalidad !== 'individual') {
    frases.push(`Por equipos: ${plural(e.victorias, 'victoria', 'victorias')} y ${plural(e.derrotas, 'derrota', 'derrotas')} en ${plural(e.asaltos, 'encuentro', 'encuentros')}.`);
  }
  const conCruces = d.temporadas.filter((t) => t.individual.victorias + t.individual.derrotas >= 5);
  const mejor = [...conCruces].sort((a, b) => ratio(b) - ratio(a) || b.temporada.localeCompare(a.temporada))[0];
  if (mejor && conCruces.length > 2 && !f.temporada && f.modalidad !== 'equipos') {
    frases.push(`Su mejor temporada fue la ${temporadaCorta(mejor.temporada)}: ${cifra(mejor.individual.victorias)} victorias y ${cifra(mejor.individual.derrotas)} derrotas.`);
  }
  return frases;
}

const ratio = (t: DueloPaises['temporadas'][number]) => t.individual.victorias / Math.max(1, t.individual.victorias + t.individual.derrotas);
