import type { DatoFicha } from '@/components/tirador/cabecera';
import type { FichaFie, PuestoMundialFie, PuestoOficial } from '@/lib/queries/ranking';
import { CATEGORY_LABEL, WEAPON_LABEL, formatDateEs } from '@/lib/utils';
import type { LadoRanking, VarianteRanking } from './ficha-ranking';
import type { TemporadaRanking } from './tira-temporadas';
import { puntos } from './formato';
import type { LadoCompacto } from './mis-tiradores';
import { ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import type { MejorMundial } from '@/lib/sport/explorar/ranking-nacional';

/**
 * ===========================================================================
 * DE LOS DATOS A LA FICHA
 * ===========================================================================
 *
 * Funciones puras que traducen lo que devuelven `getPuestosOficiales` y
 * `getFichasFie` a lo que pinta `FichaRanking`. Viven aparte de la pantalla
 * por dos motivos:
 *
 * - `page.tsx` se queda leyéndose: pide los datos y los pinta, sin cuarenta
 *   líneas de amasado en medio.
 * - Aquí es donde se decide qué NO se enseña, y eso merece estar escrito en un
 *   sitio y no repartido. Sobre todo el club: `source_club` no trae un nombre,
 *   trae un código de Skermo (`FED-M-C`, `100TO-C`, `AEC-CU`), y enseñar
 *   `FED-M-C` donde la gente espera «CE Valencia» es ruido que además parece
 *   un fallo. Hasta que el código esté resuelto a un nombre legible, el campo
 *   no se pinta. Lo que no se hace es inventarse la correspondencia.
 */

/** «Florete absoluto». Sin el género: un tirador solo tiene uno. */
function etiquetaVariante(weapon: string, category: string): string {
  const arma = WEAPON_LABEL[weapon as keyof typeof WEAPON_LABEL] ?? weapon;
  const cat = CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category;
  return `${arma} ${cat.toLowerCase()}`;
}

function clave(weapon: string, category: string): string {
  return `${weapon}|${category}`;
}

function nombreCategoria(category: string): string {
  return CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category;
}

/**
 * ---------------------------------------------------------------------------
 * LADO NACIONAL: la clasificación oficial de la RFEE
 * ---------------------------------------------------------------------------
 * Es la que decide convocatorias y la que la gente reconoce. No se recalcula
 * ni se retoca: se enseña tal y como se leyó, con la fecha de la lectura.
 *
 * Una fila por temporada, arma y categoría. Se agrupa por arma y categoría
 * para que las temporadas de la misma clasificación formen la tira, que es lo
 * que permite ver la evolución. Hoy solo hay una temporada ingerida y la tira
 * sale con una tarjeta; cuando entre la siguiente, crece sola. Que solo haya
 * una se **dice**, no se disimula.
 */
export function ladoNacional(
  puestos: PuestoOficial[],
  extra: { licencia: string | null; anioNacimiento: number | null } = { licencia: null, anioNacimiento: null },
): LadoRanking {
  const porClasificacion = new Map<string, PuestoOficial[]>();
  for (const p of puestos) {
    const k = clave(p.weapon, p.category);
    porClasificacion.set(k, [...(porClasificacion.get(k) ?? []), p]);
  }

  const variantes: VarianteRanking[] = [];

  for (const [k, filas] of porClasificacion) {
    // Temporada más reciente primero. `seasonLabel` es «2026-2027»: ordena bien
    // como cadena, así que no hace falta convertirlo a nada.
    const ordenadas = [...filas].sort((a, b) =>
      b.seasonLabel.localeCompare(a.seasonLabel),
    );
    const vigente = ordenadas[0];

    const temporadas: TemporadaRanking[] = ordenadas.map((p) => ({
      id: `${p.seasonLabel}|${k}`,
      temporada: p.seasonLabel,
      puesto: p.position,
      categoria: nombreCategoria(p.category),
      puntos: p.totalPoints,
    }));

    /** Cinco pares y sin «Temporada»: ya lo dice la procedencia de abajo. */
    const pares: DatoFicha[] = [
      {
        etiqueta: 'Puntos oficiales',
        valor: vigente.totalPoints === null ? null : puntos(vigente.totalPoints),
        destacado: true,
      },
      { etiqueta: 'Arma', valor: WEAPON_LABEL[vigente.weapon] },
      {
        etiqueta: 'Categoría',
        valor: nombreCategoria(vigente.category),
        // La FIE llama a esto «Senior»; la RFEE publica «VET50» y nosotros lo
        // normalizamos a VET. Se dice el literal de la fuente cuando difiere,
        // para que se pueda comprobar.
        pie:
          vigente.categoryRaw && vigente.categoryRaw !== vigente.category
            ? `la fuente lo publica como «${vigente.categoryRaw}»`
            : undefined,
      },
      { etiqueta: 'Licencia RFEE', valor: extra.licencia },
      {
        etiqueta: 'Año de nacimiento',
        valor: extra.anioNacimiento === null ? null : String(extra.anioNacimiento),
      },
    ];

    variantes.push({
      clave: k,
      etiqueta: etiquetaVariante(vigente.weapon, vigente.category),
      insignia: {
        puesto: vigente.position,
        // «3.º de 50» es la cifra cierta: los que aparecen sin puesto no son
        // nadie a quien ganar. El razonamiento largo está en `deCuantos`.
        rotulo:
          vigente.deCuantos > 0 ? `de ${vigente.deCuantos} en España` : 'en España',
        tono: 'acento',
      },
      pares,
      temporadas,
      tituloTemporadas: 'Temporadas en el ranking nacional',
      contextoTemporadas:
        temporadas.length > 1
          ? 'Una tarjeta por temporada de la clasificación oficial. La flecha compara con la anterior.'
          : `De la clasificación oficial solo está leída la temporada ${vigente.seasonLabel}, así que todavía no hay evolución que comparar. En cuanto entre otra, aparecerá aquí al lado.`,
      procedencia: `Clasificación oficial de la RFEE, temporada ${vigente.seasonLabel}, leída el ${formatDateEs(vigente.actualizadoEl)}. No la calcula esta aplicación.`,
      urlFuente: vigente.sourceUrl,
    });
  }

  // Mejor puesto primero: si alguien está 3.º en absoluto y 12.º en M23, lo
  // primero que quiere ver es el 3.º.
  variantes.sort(
    (a, b) => (a.insignia.puesto ?? 9e9) - (b.insignia.puesto ?? 9e9),
  );

  return {
    federacion: 'RFEE',
    etiqueta: 'Nacional',
    variantes,
    motivoVacio:
      'Este tirador no aparece en la clasificación oficial de la RFEE que hemos leído. ' +
      'O no está en ella, o su ficha todavía no se ha emparejado con su licencia.',
  };
}

/**
 * Lo único de un lado que pinta la tarjeta de /ranking (y viaja al cliente):
 * federación, rótulo, motivo del vacío y el mejor puesto. Los pares y las
 * temporadas se quedan en el servidor: llevan licencia y año de nacimiento.
 */
export function ladoCompacto(lado: LadoRanking): LadoCompacto {
  const mejor = lado.variantes[0];
  return {
    federacion: lado.federacion,
    etiqueta: lado.etiqueta,
    motivoVacio: lado.motivoVacio,
    mejor: mejor ? { etiqueta: mejor.etiqueta, puesto: mejor.insignia.puesto } : null,
  };
}

/**
 * El lado internacional de la tarjeta con el puesto de la clasificación FIE
 * vigente, la misma que pinta la tabla de abajo y la cabecera del perfil,
 * cruzada por el id FIE confirmado de la persona (nunca por el nombre). Sin
 * puesto en ella se queda lo que traía la ficha FIE.
 */
export function conClasificacionFie(lado: LadoCompacto, actuales: readonly MejorMundial[]): LadoCompacto {
  // Absoluto antes que las de edad y, dentro, el mejor puesto: como la cabecera del perfil.
  const mejor = [...actuales].sort((a, b) =>
    ordenCategoriaVisible(a.categoria) - ordenCategoriaVisible(b.categoria) || a.puesto - b.puesto)[0];
  return mejor ? { ...lado, mejor: { etiqueta: etiquetaVariante(mejor.arma, mejor.categoria), puesto: mejor.puesto } } : lado;
}

/**
 * ---------------------------------------------------------------------------
 * LADO INTERNACIONAL: el ranking de la FIE
 * ---------------------------------------------------------------------------
 * Aquí está la tira de temporadas en su mejor versión, porque la FIE publica
 * el histórico completo: de Carlos Llavador constan 19 temporadas.
 *
 * Dos cosas que no se pintan:
 *
 * - **La altura.** La ficha de la FIE la tiene y nosotros no. En su propia
 *   pantalla sale «Height: 0», que es exactamente lo que no se hace aquí: un
 *   campo que no tenemos no se pasa.
 * - **El país.** `fie_fencer.country_code` está en la base pero `getFichasFie`
 *   no lo devuelve, y ese fichero no es nuestro. Sin él no se pinta la
 *   pastilla de bandera: poner «España» porque es la selección española sería
 *   deducirlo, no leerlo.
 */
export function ladoMundial(ficha: FichaFie | null): LadoRanking {
  const variantes: VarianteRanking[] = [];

  if (ficha) {
    const porClasificacion = new Map<string, PuestoMundialFie[]>();
    for (const c of ficha.clasificaciones) {
      const k = clave(c.weapon, c.category);
      porClasificacion.set(k, [...(porClasificacion.get(k) ?? []), c]);
    }

    for (const [k, filas] of porClasificacion) {
      const ordenadas = [...filas].sort(
        (a, b) => b.season - a.season || (a.position ?? 9e9) - (b.position ?? 9e9),
      );

      /**
       * El puesto vigente es el de la temporada más reciente que tenga puesto.
       * Una temporada sin puesto no es un buen puesto: es la ausencia de uno.
       */
      const vigente = ordenadas.find((c) => c.position !== null) ?? ordenadas[0];

      const conPuesto = ordenadas.filter(
        (c): c is PuestoMundialFie & { position: number } => c.position !== null,
      );
      const mejor =
        conPuesto.length === 0
          ? null
          : conPuesto.reduce((m, c) => (c.position < m.position ? c : m));

      const temporadas: TemporadaRanking[] = ordenadas.map((c) => ({
        id: `${c.season}|${k}`,
        temporada: String(c.season),
        puesto: c.position,
        categoria: nombreCategoria(c.category),
        puntos: c.points,
        pruebas: c.eventCount,
      }));

      /**
       * Cinco pares, no siete, y eso es una corrección con motivo.
       *
       * Con siete, en un iPhone la ficha no entraba de una: «Temporada» y
       * «Pruebas que le puntúan» quedaban cortadas por el pliegue con el mismo
       * peso tipográfico que «Puntos FIE», que sí es el titular. Así que:
       *
       * - **«Temporada» se va.** Era un duplicado literal: la línea de
       *   procedencia de abajo ya dice de qué temporada es lo que se está
       *   mirando.
       * - **«Pruebas» baja al pie de los puntos**, que es de lo que habla («68,5
       *   puntos en 11 pruebas»), en vez de ser un par por su cuenta.
       */
      const pares: DatoFicha[] = [
        {
          etiqueta: 'Puntos',
          valor: vigente.points === null ? null : puntos(vigente.points),
          pie:
            vigente.eventCount === null
              ? undefined
              : `en ${vigente.eventCount} ${vigente.eventCount === 1 ? 'prueba' : 'pruebas'}`,
          destacado: true,
        },
        {
          etiqueta: 'Mejor puesto',
          valor: mejor === null ? null : `${mejor.position}.º`,
          pie: mejor === null ? undefined : `en la temporada ${mejor.season}`,
          destacado: true,
        },
        { etiqueta: 'Arma', valor: WEAPON_LABEL[vigente.weapon] },
        {
          etiqueta: 'Categoría',
          valor: nombreCategoria(vigente.category),
          pie:
            vigente.ageBand !== null
              ? `tramo de edad ${vigente.ageBand}`
              : undefined,
        },
        {
          etiqueta: 'Mano hábil',
          valor:
            ficha.mano === 'L' ? 'Zurdo' : ficha.mano === 'R' ? 'Diestro' : null,
        },
      ];

      variantes.push({
        clave: k,
        etiqueta: etiquetaVariante(vigente.weapon, vigente.category),
        insignia: {
          puesto: vigente.position,
          rotulo: 'internacional',
          tono: 'acento',
        },
        pares,
        temporadas,
        tituloTemporadas: 'Temporadas en el ranking internacional',
        contextoTemporadas:
          temporadas.length > 1
            ? `${temporadas.length} temporadas publicadas por la FIE. La flecha compara con la anterior.`
            : 'La FIE solo publica una temporada de este tirador, así que todavía no hay evolución que comparar.',
        procedencia: `Ranking internacional de la FIE, leído el ${formatDateEs(ficha.actualizadoEl)}. La foto y el puesto son suyos y se enlazan a su ficha; no se copian.`,
        urlFuente: ficha.fichaUrl,
      });
    }

    variantes.sort(
      (a, b) => (a.insignia.puesto ?? 9e9) - (b.insignia.puesto ?? 9e9),
    );
  }

  return {
    federacion: 'FIE',
    etiqueta: 'Internacional',
    variantes,
    motivoVacio:
      'Este tirador todavía no tiene ficha confirmada en la FIE, así que no hay puesto internacional ' +
      'ni foto que enseñar. Se confirma desde Gestión, con la evidencia del emparejamiento delante.',
  };
}
