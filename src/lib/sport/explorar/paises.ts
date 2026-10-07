import { rutaPais as rutaFichaPais } from './pais-url';
import { casarPalabra, palabrasConsulta, plegarTexto } from './texto-difuso';

/**
 * Países que se pueden buscar: código del COI (el que se lee en esgrima: ESP,
 * ITA, HUN), nombre en castellano y otros nombres con los que se busca. Los
 * nombres van escritos aquí y no salen de `Intl.DisplayNames`: el ICU de Node
 * y el del navegador no coinciden en todos y la lista se filtra en los dos.
 */
export type Pais = { codigo: string; nombre: string; otros?: readonly string[] };

export const PAISES: readonly Pais[] = [
  { codigo: 'ALB', nombre: 'Albania' },
  { codigo: 'ALG', nombre: 'Argelia', otros: ['Algeria', 'Algérie'] },
  { codigo: 'AND', nombre: 'Andorra' },
  { codigo: 'ANG', nombre: 'Angola' },
  { codigo: 'ANT', nombre: 'Antigua y Barbuda', otros: ['Antigua and Barbuda'] },
  { codigo: 'ARG', nombre: 'Argentina' },
  { codigo: 'ARM', nombre: 'Armenia' },
  { codigo: 'AUS', nombre: 'Australia' },
  { codigo: 'AUT', nombre: 'Austria', otros: ['Österreich', 'Autriche'] },
  { codigo: 'AZE', nombre: 'Azerbaiyán', otros: ['Azerbaijan'] },
  { codigo: 'BAN', nombre: 'Bangladés', otros: ['Bangladesh'] },
  { codigo: 'BAR', nombre: 'Barbados' },
  { codigo: 'BEL', nombre: 'Bélgica', otros: ['Belgium', 'Belgique'] },
  { codigo: 'BEN', nombre: 'Benín', otros: ['Benin'] },
  { codigo: 'BER', nombre: 'Bermudas', otros: ['Bermuda'] },
  { codigo: 'BIH', nombre: 'Bosnia y Herzegovina', otros: ['Bosnia and Herzegovina'] },
  { codigo: 'BLR', nombre: 'Bielorrusia', otros: ['Belarus', 'Biélorussie'] },
  { codigo: 'BOL', nombre: 'Bolivia' },
  { codigo: 'BOT', nombre: 'Botsuana', otros: ['Botswana'] },
  { codigo: 'BRA', nombre: 'Brasil', otros: ['Brazil', 'Brésil'] },
  { codigo: 'BRN', nombre: 'Baréin', otros: ['Bahrain', 'Bahréin'] },
  { codigo: 'BRU', nombre: 'Brunéi', otros: ['Brunei'] },
  { codigo: 'BUL', nombre: 'Bulgaria', otros: ['Bulgarie'] },
  { codigo: 'BUR', nombre: 'Burkina Faso' },
  { codigo: 'CAM', nombre: 'Camboya', otros: ['Cambodia'] },
  { codigo: 'CAN', nombre: 'Canadá', otros: ['Canada'] },
  { codigo: 'CGO', nombre: 'Congo' },
  { codigo: 'CHI', nombre: 'Chile' },
  { codigo: 'CHN', nombre: 'China', otros: ['Chine'] },
  { codigo: 'CIV', nombre: 'Costa de Marfil', otros: ["Côte d'Ivoire", 'Ivory Coast'] },
  { codigo: 'CMR', nombre: 'Camerún', otros: ['Cameroon', 'Cameroun'] },
  { codigo: 'COD', nombre: 'República Democrática del Congo', otros: ['RD Congo', 'DR Congo'] },
  { codigo: 'COL', nombre: 'Colombia' },
  { codigo: 'CPV', nombre: 'Cabo Verde', otros: ['Cape Verde'] },
  { codigo: 'CRC', nombre: 'Costa Rica' },
  { codigo: 'CRO', nombre: 'Croacia', otros: ['Croatia', 'Hrvatska', 'Croatie'] },
  { codigo: 'CUB', nombre: 'Cuba' },
  { codigo: 'CYP', nombre: 'Chipre', otros: ['Cyprus', 'Chypre'] },
  { codigo: 'CZE', nombre: 'Chequia', otros: ['República Checa', 'Czech Republic', 'Czechia'] },
  { codigo: 'DEN', nombre: 'Dinamarca', otros: ['Denmark', 'Danemark'] },
  { codigo: 'DOM', nombre: 'República Dominicana', otros: ['Dominican Republic'] },
  { codigo: 'ECU', nombre: 'Ecuador' },
  { codigo: 'EGY', nombre: 'Egipto', otros: ['Egypt', 'Égypte'] },
  { codigo: 'ESA', nombre: 'El Salvador' },
  { codigo: 'ESP', nombre: 'España', otros: ['Spain', 'Espagne'] },
  { codigo: 'EST', nombre: 'Estonia', otros: ['Estonie'] },
  { codigo: 'ETH', nombre: 'Etiopía', otros: ['Ethiopia'] },
  { codigo: 'FIN', nombre: 'Finlandia', otros: ['Finland', 'Finlande'] },
  { codigo: 'FRA', nombre: 'Francia', otros: ['France'] },
  { codigo: 'GAB', nombre: 'Gabón', otros: ['Gabon'] },
  { codigo: 'GBR', nombre: 'Gran Bretaña', otros: ['Reino Unido', 'Great Britain', 'United Kingdom', 'Inglaterra'] },
  { codigo: 'GEO', nombre: 'Georgia', otros: ['Géorgie'] },
  { codigo: 'GER', nombre: 'Alemania', otros: ['Germany', 'Deutschland', 'Allemagne'] },
  { codigo: 'GHA', nombre: 'Ghana' },
  { codigo: 'GRE', nombre: 'Grecia', otros: ['Greece', 'Grèce'] },
  { codigo: 'GUA', nombre: 'Guatemala' },
  { codigo: 'GUI', nombre: 'Guinea' },
  { codigo: 'GUY', nombre: 'Guyana' },
  { codigo: 'HAI', nombre: 'Haití', otros: ['Haiti'] },
  { codigo: 'HKG', nombre: 'Hong Kong' },
  { codigo: 'HON', nombre: 'Honduras' },
  { codigo: 'HUN', nombre: 'Hungría', otros: ['Hungary', 'Hongrie', 'Magyarország'] },
  { codigo: 'INA', nombre: 'Indonesia' },
  { codigo: 'IND', nombre: 'India', otros: ['Inde'] },
  { codigo: 'IRI', nombre: 'Irán', otros: ['Iran'] },
  { codigo: 'IRL', nombre: 'Irlanda', otros: ['Ireland', 'Irlande'] },
  { codigo: 'IRQ', nombre: 'Irak', otros: ['Iraq'] },
  { codigo: 'ISL', nombre: 'Islandia', otros: ['Iceland', 'Islande'] },
  { codigo: 'ISR', nombre: 'Israel', otros: ['Israël'] },
  { codigo: 'ISV', nombre: 'Islas Vírgenes de EE. UU.', otros: ['US Virgin Islands'] },
  { codigo: 'ITA', nombre: 'Italia', otros: ['Italy', 'Italie'] },
  { codigo: 'JAM', nombre: 'Jamaica' },
  { codigo: 'JOR', nombre: 'Jordania', otros: ['Jordan'] },
  { codigo: 'JPN', nombre: 'Japón', otros: ['Japan', 'Japon'] },
  { codigo: 'KAZ', nombre: 'Kazajistán', otros: ['Kazakhstan', 'Kazajstán'] },
  { codigo: 'KEN', nombre: 'Kenia', otros: ['Kenya'] },
  { codigo: 'KGZ', nombre: 'Kirguistán', otros: ['Kyrgyzstan'] },
  { codigo: 'KOR', nombre: 'Corea del Sur', otros: ['Corea', 'South Korea', 'Korea'] },
  { codigo: 'KOS', nombre: 'Kosovo' },
  { codigo: 'KSA', nombre: 'Arabia Saudí', otros: ['Arabia Saudita', 'Saudi Arabia'] },
  { codigo: 'KUW', nombre: 'Kuwait' },
  { codigo: 'LAT', nombre: 'Letonia', otros: ['Latvia', 'Lettonie'] },
  { codigo: 'LBA', nombre: 'Libia', otros: ['Libya'] },
  { codigo: 'LBN', nombre: 'Líbano', otros: ['Lebanon', 'Liban'] },
  { codigo: 'LIE', nombre: 'Liechtenstein' },
  { codigo: 'LTU', nombre: 'Lituania', otros: ['Lithuania', 'Lituanie'] },
  { codigo: 'LUX', nombre: 'Luxemburgo', otros: ['Luxembourg'] },
  { codigo: 'MAC', nombre: 'Macao', otros: ['Macau'] },
  { codigo: 'MAD', nombre: 'Madagascar' },
  { codigo: 'MAR', nombre: 'Marruecos', otros: ['Morocco', 'Maroc'] },
  { codigo: 'MAS', nombre: 'Malasia', otros: ['Malaysia'] },
  { codigo: 'MDA', nombre: 'Moldavia', otros: ['Moldova'] },
  { codigo: 'MEX', nombre: 'México', otros: ['Mexico', 'Mexique'] },
  { codigo: 'MGL', nombre: 'Mongolia', otros: ['Mongolie'] },
  { codigo: 'MKD', nombre: 'Macedonia del Norte', otros: ['North Macedonia', 'Macedonia'] },
  { codigo: 'MLI', nombre: 'Mali', otros: ['Malí'] },
  { codigo: 'MLT', nombre: 'Malta', otros: ['Malte'] },
  { codigo: 'MNE', nombre: 'Montenegro', otros: ['Monténégro'] },
  { codigo: 'MON', nombre: 'Mónaco', otros: ['Monaco'] },
  { codigo: 'MOZ', nombre: 'Mozambique' },
  { codigo: 'MRI', nombre: 'Mauricio', otros: ['Mauritius', 'Maurice'] },
  { codigo: 'MTN', nombre: 'Mauritania', otros: ['Mauritanie'] },
  { codigo: 'NAM', nombre: 'Namibia' },
  { codigo: 'NCA', nombre: 'Nicaragua' },
  { codigo: 'NED', nombre: 'Países Bajos', otros: ['Holanda', 'Netherlands', 'Holland', 'Pays-Bas'] },
  { codigo: 'NEP', nombre: 'Nepal' },
  { codigo: 'NGR', nombre: 'Nigeria' },
  { codigo: 'NIG', nombre: 'Níger', otros: ['Niger'] },
  { codigo: 'NOR', nombre: 'Noruega', otros: ['Norway', 'Norvège'] },
  { codigo: 'NZL', nombre: 'Nueva Zelanda', otros: ['New Zealand'] },
  { codigo: 'OMA', nombre: 'Omán', otros: ['Oman'] },
  { codigo: 'PAK', nombre: 'Pakistán', otros: ['Pakistan'] },
  { codigo: 'PAN', nombre: 'Panamá', otros: ['Panama'] },
  { codigo: 'PAR', nombre: 'Paraguay' },
  { codigo: 'PER', nombre: 'Perú', otros: ['Peru', 'Pérou'] },
  { codigo: 'PHI', nombre: 'Filipinas', otros: ['Philippines'] },
  { codigo: 'POL', nombre: 'Polonia', otros: ['Poland', 'Pologne', 'Polska'] },
  { codigo: 'POR', nombre: 'Portugal' },
  { codigo: 'PUR', nombre: 'Puerto Rico' },
  { codigo: 'QAT', nombre: 'Catar', otros: ['Qatar'] },
  { codigo: 'ROU', nombre: 'Rumanía', otros: ['Rumania', 'Romania', 'Roumanie'] },
  { codigo: 'RSA', nombre: 'Sudáfrica', otros: ['South Africa', 'Afrique du Sud'] },
  { codigo: 'RUS', nombre: 'Rusia', otros: ['Russia', 'Russie'] },
  { codigo: 'RWA', nombre: 'Ruanda', otros: ['Rwanda'] },
  { codigo: 'SEN', nombre: 'Senegal', otros: ['Sénégal'] },
  { codigo: 'SGP', nombre: 'Singapur', otros: ['Singapore'] },
  { codigo: 'SLE', nombre: 'Sierra Leona', otros: ['Sierra Leone'] },
  { codigo: 'SLO', nombre: 'Eslovenia', otros: ['Slovenia', 'Slovénie'] },
  { codigo: 'SMR', nombre: 'San Marino' },
  { codigo: 'SRB', nombre: 'Serbia', otros: ['Serbie'] },
  { codigo: 'SRI', nombre: 'Sri Lanka' },
  { codigo: 'SUD', nombre: 'Sudán', otros: ['Sudan'] },
  { codigo: 'SUI', nombre: 'Suiza', otros: ['Switzerland', 'Suisse', 'Schweiz'] },
  { codigo: 'SUR', nombre: 'Surinam', otros: ['Suriname'] },
  { codigo: 'SVK', nombre: 'Eslovaquia', otros: ['Slovakia', 'Slovaquie'] },
  { codigo: 'SWE', nombre: 'Suecia', otros: ['Sweden', 'Suède'] },
  { codigo: 'SYR', nombre: 'Siria', otros: ['Syria'] },
  { codigo: 'THA', nombre: 'Tailandia', otros: ['Thailand'] },
  { codigo: 'TJK', nombre: 'Tayikistán', otros: ['Tajikistan'] },
  { codigo: 'TKM', nombre: 'Turkmenistán', otros: ['Turkmenistan'] },
  { codigo: 'TOG', nombre: 'Togo' },
  { codigo: 'TPE', nombre: 'Taipéi Chino', otros: ['Taiwán', 'Chinese Taipei', 'Taiwan'] },
  { codigo: 'TTO', nombre: 'Trinidad y Tobago', otros: ['Trinidad and Tobago'] },
  { codigo: 'TUN', nombre: 'Túnez', otros: ['Tunisia', 'Tunisie'] },
  { codigo: 'TUR', nombre: 'Turquía', otros: ['Turkey', 'Türkiye', 'Turquie'] },
  { codigo: 'TAN', nombre: 'Tanzania' },
  { codigo: 'UAE', nombre: 'Emiratos Árabes Unidos', otros: ['Emiratos', 'United Arab Emirates', 'EAU'] },
  { codigo: 'UGA', nombre: 'Uganda' },
  { codigo: 'UKR', nombre: 'Ucrania', otros: ['Ukraine'] },
  { codigo: 'URU', nombre: 'Uruguay' },
  { codigo: 'USA', nombre: 'Estados Unidos', otros: ['EE. UU.', 'EEUU', 'United States', 'États-Unis'] },
  { codigo: 'UZB', nombre: 'Uzbekistán', otros: ['Uzbekistan'] },
  { codigo: 'VEN', nombre: 'Venezuela' },
  { codigo: 'VIE', nombre: 'Vietnam' },
  { codigo: 'YEM', nombre: 'Yemen' },
  { codigo: 'ZAM', nombre: 'Zambia' },
  { codigo: 'ZIM', nombre: 'Zimbabue', otros: ['Zimbabwe'] },
].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

const POR_CODIGO = new Map(PAISES.map((p) => [p.codigo, p]));

export function paisPorCodigo(codigo: string): Pais | null {
  return POR_CODIGO.get(codigo.trim().toUpperCase()) ?? null;
}

/** Pantalla de un país: el contrato es `rutaPais` de `pais-url.ts`, con el código en mayúsculas. */
export function rutaPais(codigo: string): string {
  return rutaFichaPais(codigo.trim().toUpperCase());
}

type Entrada = { pais: Pais; terminos: string[]; nombrePlegado: string };

let entradas: Entrada[] | null = null;
let vocabulario: string[] = [];

function preparar(): Entrada[] {
  if (entradas) return entradas;
  const todos = new Set<string>();
  entradas = PAISES.map((pais) => {
    const terminos = new Set<string>([pais.codigo.toLowerCase()]);
    for (const nombre of [pais.nombre, ...(pais.otros ?? [])]) {
      for (const t of plegarTexto(nombre).split(' ')) if (t.length > 1) terminos.add(t);
    }
    terminos.forEach((t) => todos.add(t));
    return { pais, terminos: [...terminos], nombrePlegado: plegarTexto(pais.nombre) };
  });
  vocabulario = [...todos];
  return entradas;
}

/**
 * Países que casan con lo escrito: por código («ESP»), por nombre en
 * castellano o en otros idiomas, por prefijo («ital») y con una errata
 * («itlia»). Primero el código exacto, luego los que empiezan igual y luego
 * por nombre.
 */
export function buscarPaises(q: string, limite = 8): Pais[] {
  const lista = preparar();
  const palabras = palabrasConsulta(q).filter((p) => p.cruda.length >= 2);
  if (palabras.length === 0) return [];
  const casadas = palabras.map((p) => casarPalabra(p, vocabulario));
  const plegada = plegarTexto(q);
  const puntuados: { pais: Pais; puntos: number }[] = [];
  for (const e of lista) {
    let puntos = 0;
    let todas = true;
    for (const c of casadas) {
      let mejor = 0;
      for (const t of e.terminos) mejor = Math.max(mejor, c.get(t) ?? 0);
      if (mejor === 0) { todas = false; break; }
      puntos += mejor;
    }
    if (!todas) continue;
    if (e.pais.codigo.toLowerCase() === plegada) puntos += 10;
    if (e.nombrePlegado === plegada) puntos += 8;
    else if (e.nombrePlegado.startsWith(plegada)) puntos += 4;
    puntuados.push({ pais: e.pais, puntos });
  }
  return puntuados
    .sort((a, b) => b.puntos - a.puntos || a.pais.nombre.localeCompare(b.pais.nombre, 'es'))
    .slice(0, limite)
    .map((p) => p.pais);
}
