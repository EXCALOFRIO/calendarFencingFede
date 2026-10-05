import { SALTOS } from './personas';

/**
 * Reconstrucción completa del índice de palabras de Explorar (migración 0004)
 * a partir de sport_person, sport_person_alias y el índice persona/fecha de
 * sport_result. Sólo escribe en `explorar_*`, nunca en `sport_*`: no necesita
 * lease ni pasa por el libro de capacidad. Debe ejecutarse entera en UNA
 * transacción (un fichero de `wrangler d1 execute --remote --file` lo es): las
 * marcas de rowid salen del mismo estado que se indexa y quien lee ve el
 * índice anterior o el nuevo, nunca uno a medias.
 *
 * Grupo de fusión y cadenas buscables son los de la búsqueda sin índice: el
 * nombre de la persona que prevalece y los alias de todo su grupo (hasta
 * `SALTOS` niveles).
 */
export const VERSION_INDICE = 1;

/** Palabras más largas no generan variantes de errata. */
export const MAX_LETRAS_VARIANTE = 24;

const MIEMBROS = `miembros(raiz, id, salto) AS (
    SELECT id, id, 0 FROM sport_person WHERE merged_into_person_id IS NULL
    UNION ALL
    SELECT m.raiz, p.id, m.salto + 1
    FROM miembros m JOIN sport_person p ON p.merged_into_person_id = m.id
    WHERE m.salto < ${SALTOS}
  )`;

export const SENTENCIAS_INDICE: readonly string[] = [
  'DELETE FROM explorar_variante',
  'DELETE FROM explorar_token',
  'DELETE FROM explorar_persona',
  'DELETE FROM explorar_indice_estado',
  // El peso sale del índice persona/fecha sin leer la tabla de resultados:
  // recorrerla por persona es acceso aleatorio a toda la tabla.
  `INSERT INTO explorar_persona (n, id, name_normalized, peso)
  WITH RECURSIVE ${MIEMBROS},
  pesos(persona, peso) AS MATERIALIZED (
    SELECT person_id, count(*) FROM sport_result INDEXED BY sport_result_person_date_idx
    WHERE person_id IS NOT NULL GROUP BY person_id
  ),
  por_raiz(raiz, peso) AS MATERIALIZED (
    SELECT m.raiz, sum(w.peso) FROM miembros m JOIN pesos w ON w.persona = m.id GROUP BY m.raiz
  )
  SELECT row_number() OVER (ORDER BY p.name_normalized, p.id), p.id, p.name_normalized,
         coalesce(r.peso, 0)
  FROM sport_person p LEFT JOIN por_raiz r ON r.raiz = p.id
  WHERE p.merged_into_person_id IS NULL`,
  `INSERT OR IGNORE INTO explorar_token (token, n)
  WITH RECURSIVE ${MIEMBROS},
  cadenas(n, texto) AS (
    SELECT n, name_normalized FROM explorar_persona
    UNION
    SELECT ep.n, a.name_normalized
    FROM miembros m
    JOIN explorar_persona ep ON ep.id = m.raiz
    JOIN sport_person_alias a ON a.person_id = m.id
  ),
  partes(n, token, resto) AS (
    SELECT n, '', texto || ' ' FROM cadenas
    UNION ALL
    SELECT n, substr(resto, 1, instr(resto, ' ') - 1), substr(resto, instr(resto, ' ') + 1)
    FROM partes WHERE resto <> ''
  )
  SELECT token, n FROM partes WHERE token <> ''`,
  `INSERT OR IGNORE INTO explorar_variante (clave, palabra)
  WITH RECURSIVE
  palabras(palabra) AS MATERIALIZED (
    SELECT DISTINCT token FROM explorar_token
    WHERE length(token) BETWEEN 4 AND ${MAX_LETRAS_VARIANTE}
  ),
  borrados(palabra, i) AS (
    SELECT palabra, 0 FROM palabras
    UNION ALL
    SELECT palabra, i + 1 FROM borrados WHERE i < length(palabra)
  )
  SELECT CASE WHEN i = 0 THEN palabra ELSE substr(palabra, 1, i - 1) || substr(palabra, i + 1) END,
         palabra
  FROM borrados`,
  `INSERT INTO explorar_indice_estado (key, persona_rowid, alias_rowid, version, construido_en)
  VALUES ('global',
    coalesce((SELECT max(rowid) FROM sport_person), 0),
    coalesce((SELECT max(rowid) FROM sport_person_alias), 0),
    ${VERSION_INDICE},
    cast(strftime('%s', 'now') AS integer) * 1000)`,
];
