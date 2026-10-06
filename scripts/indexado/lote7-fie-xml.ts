import * as cheerio from 'cheerio';
import type { anadirAsaltos } from './fie-huecos-asaltos';

/**
 * Lector del XML de resultados en formato FIE (`CompetitionIndividuelle`, el
 * que exportan Fencing Time y Engarde y que la EFC publicaba en
 * `service.eurofencing.info/results/downloadresultxml/<id>`).
 *
 * Poules: cada `Match` con dos tiradores y marcador; una poule cuyos totales
 * publicados (victorias, TD, TR) no salen de sus asaltos se descarta entera.
 * Cuadro: sólo la suite principal (la primera `SuiteDeTableaux`), ronda
 * `A<Taille>`; un cruce con un solo tirador es exento y no cuenta.
 */

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];
type Tirador = { nombre: string; pais: string | null };

const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

export type XmlFie = Lectura & {
  titulo: string;
  fecha: string | null;
  categoria: string | null;
  individual: boolean;
};

const ARMA: Record<string, 'ESPADA' | 'FLORETE' | 'SABLE'> = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' };

export function leerXmlFie(xml: string): XmlFie {
  const $ = cheerio.load(xml.replace(/^\uFEFF|^ï»¿/, ''), { xmlMode: true });
  const raiz = $('CompetitionIndividuelle').first();
  const tiradores = new Map<string, Tirador>();
  const puestos: Lectura['puestos'] = [];
  raiz.children('Tireurs').children('Tireur').each((_, el) => {
    const t = $(el);
    const nombre = `${t.attr('Nom') ?? ''} ${t.attr('Prenom') ?? ''}`.replace(/\s+/g, ' ').trim();
    const nacion = (t.attr('Nation') ?? '').trim();
    const tirador = { nombre, pais: /^[A-Z]{3}$/.test(nacion) ? nacion : null };
    tiradores.set(t.attr('ID') ?? '', tirador);
    const c = Number(t.attr('Classement'));
    if (Number.isInteger(c) && c > 0) puestos.push({ t: tirador, puesto: c });
  });
  const de = (ref: string | undefined) => (ref ? tiradores.get(ref) ?? null : null);

  let poules: Lectura['poules'] = null;
  const fases = raiz.find('Phases').children('TourDePoules').toArray()
    .sort((a, b) => Number($(a).attr('ID')) - Number($(b).attr('ID')));
  fases.forEach((fase, i) => {
    poules ??= { bouts: [], esperados: 0, descartados: {} };
    const prefijo = i === 0 ? 'P' : `V${i + 1}P`;
    $(fase).children('Poule').each((_, pe) => {
      const poule = $(pe);
      const numero = poule.attr('ID') ?? '';
      const stats = new Map<string, { v: number; td: number; tr: number }>();
      poule.children('Tireur').each((__, te) => {
        const t = $(te);
        stats.set(t.attr('REF') ?? '', { v: Number(t.attr('NbVictoires')), td: Number(t.attr('TD')), tr: Number(t.attr('TR')) });
      });
      const propios: BoutLeido[] = [];
      const calc = new Map<string, { v: number; td: number; tr: number }>();
      let ilegibles = 0;
      poule.children('Match').each((__, me) => {
        const lados = $(me).children('Tireur').toArray().map((x) => ({
          ref: $(x).attr('REF'), score: Number($(x).attr('Score')), statut: $(x).attr('Statut') ?? '',
        }));
        if (lados.length !== 2) return;
        poules!.esperados += 1;
        const [a, b] = lados;
        const ta = de(a.ref);
        const tb = de(b.ref);
        const valido = ta && tb && Number.isInteger(a.score) && Number.isInteger(b.score) &&
          ((a.statut === 'V') !== (b.statut === 'V')) && a.score <= 5 && b.score <= 5 &&
          (a.statut === 'V' ? a.score >= b.score : b.score >= a.score);
        if (!valido) {
          ilegibles += 1;
          return;
        }
        for (const [x, y] of [[a, b], [b, a]] as const) {
          const s = calc.get(x.ref!) ?? { v: 0, td: 0, tr: 0 };
          s.v += x.statut === 'V' ? 1 : 0;
          s.td += x.score;
          s.tr += y.score;
          calc.set(x.ref!, s);
        }
        propios.push({
          phase: 'POULE', roundKey: `${prefijo}${numero}`, a: ta, b: tb, scoreA: a.score, scoreB: b.score,
          winner: a.score === b.score ? (a.statut === 'V' ? 'A' : 'B') : null,
        });
      });
      const cuadra = ilegibles === 0 && [...stats].every(([ref, s]) => {
        const c = calc.get(ref) ?? { v: 0, td: 0, tr: 0 };
        // Un tirador retirado o excluido no tiene totales publicados (NaN): no se puede comprobar.
        return [s.v, s.td, s.tr].some(Number.isNaN) || (c.v === s.v && c.td === s.td && c.tr === s.tr);
      });
      if (ilegibles > 0) sumar(poules!.descartados, 'sin_marcador', ilegibles);
      if (!cuadra && ilegibles === 0) {
        sumar(poules!.descartados, 'totales_no_cuadran', propios.length);
        return;
      }
      poules!.bouts.push(...propios);
    });
  });

  let cuadro: Lectura['cuadro'] = null;
  const suite = raiz.find('Phases').children('PhaseDeTableaux').first().children('SuiteDeTableaux').first();
  if (suite.length > 0) {
    cuadro = { bouts: [], esperados: 0, completo: true, descartados: {} };
    suite.children('Tableau').each((_, te) => {
      const taille = Number($(te).attr('Taille'));
      $(te).children('Match').each((__, me) => {
        const lados = $(me).children('Tireur').toArray().map((x) => ({
          ref: $(x).attr('REF'), score: Number($(x).attr('Score')), statut: $(x).attr('Statut') ?? '',
        }));
        if (lados.length !== 2) return;
        cuadro!.esperados += 1;
        const [a, b] = lados;
        const ta = de(a.ref);
        const tb = de(b.ref);
        const valido = ta && tb && Number.isInteger(taille) && taille >= 2 && Number.isInteger(a.score) && Number.isInteger(b.score) &&
          ((a.statut === 'V') !== (b.statut === 'V')) && Math.max(a.score, b.score) <= 15 &&
          (a.statut === 'V' ? a.score >= b.score : b.score >= a.score);
        if (!valido) {
          sumar(cuadro!.descartados, 'sin_marcador');
          cuadro!.completo = false;
          return;
        }
        cuadro!.bouts.push({
          phase: 'TABLEAU', roundKey: `A${taille}`, a: ta, b: tb, scoreA: a.score, scoreB: b.score,
          winner: a.score === b.score ? (a.statut === 'V' ? 'A' : 'B') : null,
        });
      });
    });
  }

  return {
    titulo: raiz.attr('TitreLong') ?? '',
    fecha: raiz.attr('Date') ?? null,
    categoria: raiz.attr('Categorie') ?? null,
    individual: raiz.attr('Domaine') !== 'E',
    arma: ARMA[raiz.attr('Arme') ?? ''] ?? null,
    genero: raiz.attr('Sexe') === 'F' ? 'F' : raiz.attr('Sexe') === 'M' ? 'M' : null,
    puestos,
    poules,
    cuadro,
  };
}
