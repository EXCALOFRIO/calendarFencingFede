# Cara a cara de selecciones (versión 2 de los agregados por país)

`/explorar/pais/[codigo]/contra/[otro]` compara dos países con el mismo detalle
que el cara a cara de dos tiradores, sin recorrer `sport_bout` en ninguna
petición. Todo sale de agregados precalculados (`explorar_pais_*`) que
reconstruye `scripts/indice-explorar.ts`.

## En pantalla (de arriba abajo)

1. Filtros: género (control segmentado Masc. / Fem. / Todos), arma
   (Todas / Florete / Espada / Sable) y tres chips que abren una hoja:
   categoría, temporada y modalidad. Todo son enlaces; nada se desplaza en
   horizontal.
2. Marcador: banderas, victorias–derrotas, asaltos, porcentaje y barra.
3. Cifras: % de victorias, pruebas, tocados dados y recibidos, tocados por asalto.
4. Evolución: victorias y derrotas por temporada (`BarrasDivergentes`), balance
   acumulado y % de victorias por temporada (`LineaTemporal`), últimas 20.
5. Por fase: poule y eliminación directa.
6. Por competición: tipo de `clasificarCompeticion` (Mundial, Copa del Mundo…).
7. Últimos asaltos: los 8 más recientes, cada uno con enlace al cara a cara personal.
8. Mejores de A contra B, mejores de B contra A (mínimo 5 asaltos; por
   victorias y luego porcentaje) y bestia negra (los de B con mejor porcentaje
   contra A).
9. Individual frente a equipos (sólo con «Individual y equipos»).
10. Cruces por prueba, paginados de 10 en 10. Si la página pedida con `desde=`
    falla, se dice ahí con «Reintentar» (antes se enseñaba la primera en silencio).

En la ficha del país, «Comparar con otro país» abre una hoja con todos los
rivales (con buscador); debajo quedan los cuatro más frecuentes. Las rutas
`/explorar/pais/[c]/contra/[o]` no cambian.

## Qué cuenta

- Sólo pruebas internacionales (FIE, EFC, sede fuera de España o evento
  internacional), como en la versión 1.
- País de cada lado: el publicado en la prueba y, si falta, el de la ficha de
  la persona que prevalece (≈10 % de los resultados no publican país).
- Un asalto con el mismo tanteo en los dos lados no cuenta en nada (ni
  asaltos, ni victorias, ni tocados, ni la lista de cruces). En esgrima no hay
  empates: son 0–0 sin publicar (208 en la copia) o datos a medias (480 más).
  Así `asaltos = victorias + derrotas` en todas las tablas; antes el total no
  cuadraba con el marcador.
- Tipo de competición: `sqlTipoCompeticion()` es `clasificarCompeticion` en SQL
  (circuito documentado del evento, regla de la EFC, nombre de la edición con
  `sqlTipoPorNombre`, fuente, ámbito y sede). Comparado en la copia de
  producción con la función JS: 5.707 pruebas, 0 diferencias.

## Datos (migración `drizzle-d1/0021_explorar_selecciones.sql`, aditiva)

- `explorar_pais_prueba` gana `poule_va`, `poule_vb`, `directa_va`,
  `directa_vb` (victorias de cada lado por fase) y `tipo`. Con valor por
  defecto: el código desplegado no las nombra.
- `explorar_pais_tirador` (nueva, WITHOUT ROWID), clave
  `(pais, rival, temporada, persona_id, genero, arma, categoria, modalidad)`:
  asaltos, victorias, derrotas, tf, tc, poule_v/d, directa_v/d y ultima por
  persona que prevalece y país rival, en las dos orientaciones; una fila por
  temporada y otra con `temporada = ''` (todas). La pantalla lee su pareja y su
  temporada y agrupa por persona en el orden de la clave, sin ordenar aparte
  (D1 cuenta como leídas las filas de una ordenación: sin esto cada lista leía
  el doble).
- `VERSION_PAISES = 2`. La página sólo lee lo nuevo si `explorar_pais_estado.version >= 2`
  (`VERSION_DUELO_COMPLETO`); con la versión 1 enseña lo de antes. La versión
  va también en la clave de la caché `pais-duelo` (el DTO cambia de forma).

## Medidas (copia de producción `nuevo15.sqlite`, 13.226 pruebas, 1,56 M asaltos)

Reconstrucción local (`--local --solo-paises`, node:sqlite): 46 sentencias,
~140 s en total. Las más largas, 7-8 s en local (en workerd/D1 conviene contar
con 2-3 veces más):

| Sentencias | Qué | Filas escritas | Tiempo cada una |
| --- | --- | --- | --- |
| 1-11 | vaciar, tirar y crear tablas, códigos | ~110.000 borradas | < 0,5 s |
| 12-23 | `explorar_pais_prueba`, 12 trozos por temporada | 17.697-63.205 (585.720) | 2,4-6,9 s |
| 24-25 | sus dos índices | — | 0,3-1,5 s |
| 26-37 | `explorar_pais_tirador` por temporada, 12 trozos | 44.212-171.734 (1.547.345) | 3,2-7,8 s |
| 38-41 | todas las temporadas, 4 tramos de países | 208.850-292.663 (991.383) | 1,0-1,4 s |
| 42-46 | rivales, resumen, tiradores, medallas, estado | 109.829 | 1,4-4,5 s |

Total escrito por reconstrucción: ~3,34 M filas (la versión 1, ~0,8 M).
Los trozos van por el año en que empieza la temporada módulo 12: las doce
temporadas grandes (2014-2025, 75.000-124.000 asaltos) caen una en cada trozo.

Tamaño (dbstat): `explorar_pais_tirador` 257 MB (2.538.728 filas);
`explorar_pais_prueba` 114,5 MB + índices 79,8 MB (casi igual que en la v1: las
cinco columnas nuevas suman ~3 MB). Aumento en D1: **~260 MB** (de ~2,21 GB a
~2,47 GB de 8 GiB). Si hiciera falta espacio, quitar las filas por temporada
(dejando sólo `temporada = ''`) ahorra ~160 MB y 1,55 M filas escritas, a
cambio de no enseñar tiradores con el filtro de temporada.

Filas leídas por vista en frío (workerd local, `meta.rows_read`, misma cuenta
que factura Cloudflare; después la vista queda en la caché compartida):

| Pareja | Sin filtros | Masc. | Masc. espada | Fem. florete abs. | 2024-25 | Equipos | Página 2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ITA–FRA | 13.271 | 10.361 | 6.568 | 6.298 | 5.933 | 2.813 | 93-217 |
| ESP–FRA | 7.853 | 6.296 | 4.179 | 3.878 | 3.621 | 1.587 | 77-233 |
| ESP–ITA | 8.066 | 6.397 | 4.277 | 3.852 | 3.659 | 1.712 | 105-408 |

Desglose ITA–FRA sin filtros: estado 1, balance (`sqlDuelo`) 4.407, página de
pruebas 33, mejores de ITA 3.634, mejores y bestias de FRA 4.918, asaltos de la
página 278. Tres idas en serie a D1 (estado, lecturas en paralelo, asaltos).
Antes de la clave por persona y de la fila de todas las temporadas, la misma
vista leía 27.938 filas. Planes comprobados en `tests/explorar-pais.test.ts`
(búsqueda por clave, sin `TEMP B-TREE FOR GROUP BY`).

## Despliegue en producción

> **Aplicado el 8 de octubre de 2026** (03:37–04:03 UTC, marcador previo
> `000000bf-00000002-000050fe-297d23d811e9609ed816395c8a21a6ef`). La primera
> pasada falló en la sentencia 12: D1 limita los árboles de expresión a 100
> niveles y el tipo por nombre (pliegue de ~90 `replace` dentro de cada
> `LIKE`, con hasta 185 `OR` seguidos) los superaba; SQLite local admite 1.000
> y no lo detectó. Ahora el tipo se calcula antes, por etapas, en la tabla
> auxiliar `explorar_pais_tipo_edicion` (se borra al acabar los trozos) y los
> `OR` van agrupados por mitades. Son **52 sentencias**. Resultado comprobado:
> versión 2, 2.538.728 filas de tiradores, 0 descuadres, D1 en 2,49 GB.
>
> Antes de aplicar cualquier sentencia nueva en producción, validarla con el
> motor de D1 en local (mismo límite):
> `wrangler d1 migrations apply calendario-fie-fede-db --local --persist-to <dir>`
> y después `wrangler d1 execute … --local --persist-to <dir> --file <n>.sql`.

Ficheros generados con el código de esta versión:

- `C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\indice-paises-v2.sql`
  (las 52 sentencias juntas, 289 KB);
- `C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\indice-paises-v2\01.sql … 52.sql`
  (una por fichero; la mayor, 19,5 KB).

Regenerarlos: `npx tsx scripts/indice-explorar.ts --solo-paises --partes <dir>`
(o `--salida <f.sql>`).

Orden:

1. Migración (aditiva; el Worker desplegado sigue funcionando):
   `node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0021_explorar_selecciones.sql`
2. Reconstrucción, fichero a fichero y en orden (como la 0018, «sentencia a
   sentencia», para que ninguna pase del límite de duración de D1):
   `for ($i = 1; $i -le 52; $i++) { $f = '{0:D2}.sql' -f $i; node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file "C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\indice-paises-v2\$f"; if ($LASTEXITCODE) { break } }`
   La sentencia 1 borra el estado: mientras dura (unos minutos) las fichas de
   país dicen «Aún sin datos» al caducar el minuto de memoria del estado; la
   última (52) lo escribe con la versión 2 y una marca nueva, que renueva la
   caché. Si una falla, se puede repetir desde la primera que no terminó
   (los trozos de pruebas necesitan antes las cinco de la tabla auxiliar).
3. Comprobar: `drizzle-d1/manual/0021_explorar_selecciones.comprobar.sql`
   (versión 2, columnas nuevas, ~2,54 M filas en tirador, 0 descuadres).
4. Desplegar el Worker. Puede ir antes o después de la reconstrucción: con
   los datos de la versión 1 (con o sin la 0021) la página nueva enseña lo de
   antes, y el Worker de la versión 1 lee bien los datos de la 2 (las tablas
   que tira y crea la reconstrucción sólo ganan columnas).

Escrituras esperadas: ~3,34 M filas por reconstrucción (a 1 USD el millón si
se pasa de las incluidas en el mes). Almacenamiento: +~260 MB.

Deshacer: con el Worker de la versión 1 desplegado,
`drizzle-d1/manual/0021_explorar_selecciones.deshacer.sql` y reconstruir con el
código anterior.
