import { cn } from '@/lib/utils';

/**
 * La bandera de un país, para toda la aplicación.
 *
 * ===========================================================================
 * POR QUÉ NO ES UNA BANDERA, Y ESTÁ MEDIDO
 * ===========================================================================
 *
 * La forma corta de pintar una bandera sin una sola imagen es el emoji: se
 * saca del código ISO de dos letras sumando 127 397 a cada letra y sale
 * «🇪🇸». Cuatro líneas, cero peticiones de red, escala con la tipografía.
 *
 * **Y en Windows no funciona.** Segoe UI Emoji no trae los pares de
 * indicadores regionales, así que el navegador pinta las dos letras sueltas:
 * donde tendría que haber una bandera de España se lee «ES». Esta aplicación
 * se desarrolla y se revisa en Windows, así que eso no es un detalle: es la
 * mitad de las veces que alguien la va a mirar.
 *
 * No es una suposición. Está en la captura:
 *
 *   node tests/ui/iconos-banderas.mjs
 *      → capturas/banderas-escritorio.png   ← aquí se leen «ES FR IT DE»
 *      → capturas/banderas-iphone.png
 *
 * (La de móvil emula el tamaño del iPhone pero usa las fuentes de esta
 * máquina, así que sirve para juzgar el peso en una fila estrecha, no para
 * demostrar cómo se pinta el emoji en iOS. En iOS y Android sí se pinta; el
 * problema es Windows, y con Windows hay que contar.)
 *
 * Así que va **el código del país en una pastilla**, que es lo que hace la
 * propia FIE en sus clasificaciones: se lee igual en las tres plataformas, no
 * pide una sola imagen y no depende de la tipografía del sistema.
 *
 * Lo que se descarta y por qué, para no volver a discutirlo:
 *
 *   emoji ISO          no se pinta en Windows (probado arriba).
 *   sprite de un CDN   una petición externa por fila de ranking, y una
 *                      dependencia de un tercero en el camino crítico.
 *   SVG en el repo     es la única alternativa buena si algún día se quieren
 *                      banderas de verdad: las banderas nacionales son de
 *                      dominio público, así que se pueden guardar (al revés
 *                      que los escudos de la FIE y la RFEE, que se enlazan
 *                      desde su origen). Son ~40 países en el calendario
 *                      real. No se ha hecho ahora porque cuarenta banderas
 *                      mal dibujadas son peores que cuarenta códigos bien
 *                      puestos.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS TAMAÑOS, QUE NO SON EL MISMO CASO
 * ---------------------------------------------------------------------------
 *
 *   `tamaño="fila"`   ranking: pequeña y repetida cincuenta veces. Lo que
 *                     importa es que dé ritmo a la columna y no ensucie.
 *   `tamaño="ficha"`  ficha de torneo y tarjeta del calendario: una sola vez,
 *                     al lado de la ciudad y con el nombre del país.
 *
 * El nombre completo del país sale de `Intl.DisplayNames`, que ya viene en el
 * runtime: ni tabla de nombres ni traducciones a mano.
 */

/**
 * ISO de dos letras → código de tres de la FIE.
 *
 * **Esta tabla no se escribe a mano: es la inversa de `FIE_COUNTRY_TO_ISO2` de
 * `src/lib/ingest/mappers.ts`**, que es la que ya estaba comprobada contra los
 * códigos que publica la FIE. Hace falta el camino contrario porque la base
 * guarda el país en ISO de dos letras —lo normaliza `parseLocation`— y en
 * esgrima todo el mundo lee y dice el de tres: ESP, FRA, HUN.
 *
 * Si añades un país allí, **regenera esto** con el guion de
 * `scripts/regenerar-paises.cjs` en vez de editarlo a mano. Y lo ideal sería
 * que `mappers.ts` exportara su tabla para que no hubiera dos copias de nada:
 * está pedido en el informe a quien lleva la ingestión.
 */
export const ISO2_A_FIE: Record<string, string> = {
  AD: 'AND', AE: 'UAE', AL: 'ALB', AM: 'ARM', AO: 'ANG', AR: 'ARG',
  AT: 'AUT', AU: 'AUS', AZ: 'AZE', BA: 'BIH', BB: 'BAR', BD: 'BAN',
  BE: 'BEL', BF: 'BUR', BG: 'BUL', BH: 'BRN', BJ: 'BEN', BO: 'BOL',
  BR: 'BRA', BW: 'BOT', BY: 'BLR', CA: 'CAN', CD: 'COD', CG: 'CGO',
  CH: 'SUI', CI: 'CIV', CL: 'CHI', CM: 'CMR', CN: 'CHN', CO: 'COL',
  CR: 'CRC', CU: 'CUB', CY: 'CYP', CZ: 'CZE', DE: 'GER', DK: 'DEN',
  DO: 'DOM', DZ: 'ALG', EC: 'ECU', EE: 'EST', EG: 'EGY', ES: 'ESP',
  ET: 'ETH', FI: 'FIN', FR: 'FRA', GA: 'GAB', GB: 'GBR', GE: 'GEO',
  GH: 'GHA', GN: 'GUI', GR: 'GRE', GT: 'GUA', GY: 'GUY', HK: 'HKG',
  HN: 'HON', HR: 'CRO', HU: 'HUN', ID: 'INA', IE: 'IRL', IL: 'ISR',
  IN: 'IND', IQ: 'IRQ', IR: 'IRI', IS: 'ISL', IT: 'ITA', JM: 'JAM',
  JO: 'JOR', JP: 'JPN', KE: 'KEN', KG: 'KGZ', KR: 'KOR', KW: 'KUW',
  KZ: 'KAZ', LB: 'LBN', LI: 'LIE', LK: 'SRI', LT: 'LTU', LU: 'LUX',
  LV: 'LAT', LY: 'LBA', MA: 'MAR', MC: 'MON', MD: 'MDA', ME: 'MNE',
  MG: 'MAD', MK: 'MKD', ML: 'MLI', MN: 'MGL', MR: 'MTN', MT: 'MLT',
  MU: 'MRI', MX: 'MEX', MY: 'MAS', MZ: 'MOZ', NA: 'NAM', NE: 'NIG',
  NG: 'NGR', NI: 'NCA', NL: 'NED', NO: 'NOR', NP: 'NEP', NZ: 'NZL',
  OM: 'OMA', PA: 'PAN', PE: 'PER', PH: 'PHI', PK: 'PAK', PL: 'POL',
  PR: 'PUR', PT: 'POR', PY: 'PAR', QA: 'QAT', RO: 'ROU', RS: 'SRB',
  RU: 'RUS', SA: 'KSA', SD: 'SUD', SE: 'SWE', SG: 'SGP', SI: 'SLO',
  SK: 'SVK', SM: 'SMR', SN: 'SEN', SR: 'SUR', SV: 'ESA', SY: 'SYR',
  TG: 'TOG', TH: 'THA', TJ: 'TJK', TM: 'TKM', TN: 'TUN', TR: 'TUR',
  TT: 'TTO', TW: 'TPE', TZ: 'TAN', UA: 'UKR', UG: 'UGA', US: 'USA',
  UY: 'URU', UZ: 'UZB', VE: 'VEN', VN: 'VIE', XK: 'KOS', YE: 'YEM',
  ZA: 'RSA', ZM: 'ZAM', ZW: 'ZIM',
  /*
    Los once que faltaban, encontrados contando los países del ranking
    mundial: de 136, once no tenían código en esta tabla y se quedaban sin
    bandera. «FIE» no entra a propósito: es lo que la FIE pone cuando alguien
    compite sin bandera nacional, y eso no es un país.
  */
  AG: 'ANT',
  BM: 'BER',
  BN: 'BRU',
  CV: 'CPV',
  HT: 'HAI',
  KH: 'CAM',
  MO: 'MAC',
  RW: 'RWA',
  SL: 'SLE',
  VI: 'ISV',
};

/**
 * El código que se enseña.
 *
 * Si el país no está en la tabla se devuelve **lo que haya**, en mayúsculas.
 * No se inventa un código ni se pinta un hueco: enseñar «PF» cuando no
 * sabemos que es «Polinesia Francesa» es honesto; enseñar «???» no ayuda a
 * nadie y enseñar el de otro país sería mentir.
 */
export function codigoPais(pais: string): string {
  const iso = pais.trim().toUpperCase();
  return ISO2_A_FIE[iso] ?? iso;
}

/**
 * El nombre del país en castellano, del propio runtime.
 *
 * `Intl.DisplayNames` solo entiende el ISO de dos letras. Si llega otra cosa
 * —o el runtime no lo trae— se devuelve `null` y quien llame se queda sin
 * nombre, que es mejor que un nombre equivocado.
 */
export function nombrePais(pais: string): string | null {
  const iso = pais.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return null;
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(iso) ?? null;
  } catch {
    return null;
  }
}

/** El inverso de `ISO2_A_FIE`, para llegar del «ESP» de la FIE al «es». */
const FIE_A_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_A_FIE).map(([dos, tres]) => [tres, dos]),
);

/**
 * El ISO de DOS letras, que es el nombre del fichero de la bandera.
 *
 * Hace falta porque la aplicación recibe las dos formas: los eventos guardan
 * «ES» y la FIE publica «ESP». Devuelve `null` cuando no se sabe —por ejemplo
 * «FIE», que es lo que ponen cuando alguien compite sin bandera nacional y no
 * es un país— y entonces se pinta solo el código, que es lo honesto.
 */
function iso2De(pais: string): string | null {
  const v = pais.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v.toLowerCase();
  const dos = FIE_A_ISO2[v];
  return dos ? dos.toLowerCase() : null;
}

export type TamañoBandera = 'fila' | 'ficha';

/**
 * La pastilla de país.
 *
 * Colores: `bg-secondary`, `border` y `text-foreground`, todos variables de
 * `globals.css`. Ni un color a mano, porque la paleta está cambiando debajo
 * —el rosa pasa al rojo de la bandera— y esto tiene que cambiar con ella.
 *
 * Accesibilidad: es un `<abbr>` con el nombre completo del país en `title`,
 * que es exactamente lo que es. Cuando el nombre ya está escrito al lado
 * (`conNombre`), la pastilla pasa a `aria-hidden` para que un lector de
 * pantalla no diga «España España».
 */
export function BanderaPais({
  pais,
  tamaño = 'fila',
  conNombre = false,
  className,
}: {
  /** El país tal y como lo guarda la base: ISO de dos letras, o `null`. */
  pais: string | null | undefined;
  tamaño?: TamañoBandera;
  /** Escribe el nombre del país al lado del código. */
  conNombre?: boolean;
  className?: string;
}) {
  if (!pais?.trim()) return null;

  const codigo = codigoPais(pais);
  const nombre = nombrePais(pais);
  const iso2 = iso2De(pais);

  /**
   * ===========================================================================
   * AHORA SÍ ES UNA BANDERA
   * ===========================================================================
   *
   * Lo de arriba explica por qué durante un tiempo fue solo el código: el
   * emoji no se pinta en Windows y un sprite de un CDN mete a un tercero en el
   * camino crítico. La tercera opción que ese mismo texto señalaba como «la
   * única alternativa buena» es esta, y es la que se ha hecho: **las banderas
   * están en el repositorio**, porque las banderas nacionales son de dominio
   * público (al revés que los escudos de la FIE y la RFEE, que se enlazan).
   *
   * Y van en PNG, no en SVG, por una razón medida: los SVG de `flag-icons`
   * pesan de forma muy desigual porque algunos llevan el escudo dibujado
   * vector a vector —la mediana es 0,7 kB pero **España pesa 79 kB, México 83
   * y Serbia 177**—, y a 16 px de ancho ese detalle no se ve. Rasterizadas a
   * 48×36 (el doble de lo que se pinta) **todas pesan lo mismo y poco**: 271
   * banderas en 211 kB, la mayor 3,1 kB. Las genera
   * `node scripts/banderas.mjs`.
   *
   * El código se queda AL LADO, no se sustituye: es lo que hace la propia FIE
   * en sus clasificaciones, se lee sin depender de reconocer una bandera de
   * 16 px, y si el fichero no está —un país nuevo— la fila sigue diciendo de
   * quién es.
   *
   * `<img>` y no `next/image`: son estáticas, las sirve la red de Cloudflare
   * desde `public/` sin tocar el Worker, y pasarlas por `/_next/image` sería
   * una invocación del Worker por bandera y por tamaño.
   */
  const bandera = iso2 ? (
    <img
      src={`/banderas/${iso2}.png`}
      alt=""
      aria-hidden
      width={tamaño === 'fila' ? 18 : 22}
      height={tamaño === 'fila' ? 13.5 : 16.5}
      loading="lazy"
      decoding="async"
      /* El filete la separa del fondo cuando la bandera es casi blanca
         (Japón, Corea): sin él, la de Japón es un punto rojo flotando. */
      className={cn(
        'shrink-0 rounded-[2px] border border-white/15 object-cover',
        tamaño === 'fila' ? 'h-[13.5px] w-[18px]' : 'h-[16.5px] w-[22px]',
      )}
    />
  ) : null;

  const pastilla = (
    <abbr
      title={nombre ?? undefined}
      aria-hidden={conNombre && nombre ? true : undefined}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-sm border bg-secondary',
        'font-semibold uppercase tracking-wide text-foreground no-underline',
        'tabular-nums',
        tamaño === 'fila'
          ? 'min-w-[2.6em] px-1 py-px text-[0.625rem] leading-[1.4]'
          : 'min-w-[2.7em] px-1.5 py-0.5 text-xs leading-tight',
        conNombre ? null : className,
      )}
    >
      {codigo}
    </abbr>
  );

  if (!conNombre) {
    if (!bandera) return pastilla;
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        {bandera}
        {pastilla}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {bandera}
      {pastilla}
      <span className={tamaño === 'fila' ? 'text-xs' : 'text-sm'}>
        {nombre ?? codigo}
      </span>
    </span>
  );
}
