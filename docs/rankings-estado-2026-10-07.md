# Estado de los rankings por federación (7 de octubre de 2026)

Lectura de producción (`calendario-fie-fede-db`, sólo `SELECT`) del 7/10/2026
sobre `sport_ranking_publication` y `sport_ranking_entry`, más los informes de
carga de `calendario-trabajo\rankings-*\informe.json`. Sólo recuentos; no se
reproduce ningún dato personal.

## Resumen

- **17 organismos y 18 fuentes**: FIE mundial (`fie_tiradores` + `fie_historico`),
  EFC europeo y 15 federaciones nacionales (RFEE y 14 extranjeras: Francia,
  Italia, Hong Kong, Hungría, Gran Bretaña, Canadá, Australia, Austria, Rumanía,
  Turquía, República Checa, Países Bajos, Venezuela y Bulgaria).
- **2.367 listas y 322.753 filas** guardadas; 283.150 filas (87,7 %) vinculadas a
  una persona de la base.
- Las fuentes cargadas por lote sólo guardan las filas vinculadas
  (`soloFilasVinculadas: true` en los informes), así que en ellas el vínculo de
  lo guardado es siempre del 100 %. La cifra útil es la de la columna
  «% de lo publicado» (filas guardadas / `published_total`).
- **Tiradores con resultados internacionales** (personas canónicas con algún
  resultado en pruebas `fie` o `efc`): 53.349. De ellos:
  - 47.633 (**89,3 %**) tienen al menos un ranking de cualquier fuente;
  - 37.546 (70,4 %) tienen ranking FIE; 19.567 (36,7 %) tienen ranking EFC;
    10.028 (18,8 %) aparecen en alguna lista nacional;
  - 10.087 tienen algún ranking pero no el FIE (EFC o nacional);
  - 5.716 (10,7 %) no tienen ninguno; 1.766 de ellos no tienen país en la base.
- Sólo se actualizan solas dos fuentes: `fie_tiradores` (cron diario de las
  06:45) y `skermo_ranking` (cron de las 05:30 con la cadencia de
  `cadencia-ranking.ts`). Las otras 16 se cargan por lote con
  `scripts/rankings-internacionales.ts` y no se refrescan.
- **Qué falta** (detalle al final):
  - federaciones con muchos tiradores internacionales y sin lista nacional
    cargada: Estados Unidos, Alemania, Polonia, Rusia, Japón, Corea, Ucrania,
    China, Suecia, Grecia, Suiza, Egipto e Israel;
  - huecos de temporada en EFC, Gran Bretaña, Austria y RFEE;
  - historia de una sola temporada en Australia, Rumanía, Turquía, Hong Kong,
    Venezuela y Bulgaria;
  - el vínculo bajo de Venezuela (3 %), Canadá (18 %) y Francia (21 %).

## Tabla por federación

«Listas» y «filas» son las guardadas en producción. «% vinc.» es el porcentaje
de filas guardadas con `person_id` no nulo. «% de lo publicado» es
filas vinculadas / suma de `published_total`. «Personas» son las personas
distintas enlazadas. La «última lista» es el `published_on` más reciente; en
las fuentes con `date_basis = observed`, esa fecha es el día de la lectura y no
la de publicación.

| Federación / fuente | Ámbito | Temporadas (desde–hasta) | Huecos | Listas | Filas guardadas | % vinc. | Filas publicadas | % de lo publicado | Personas | Armas / géneros | Categorías | Última lista (base de fecha) | Actualización |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
| FIE · `fie_tiradores` | Mundial | 2024–2027 | — | 107 | 36.126 | 27,2 % | 36.126 | 27,2 % | 2.865 | F/E/S · M/F | ABS, M20, M17, VET (individual y equipos) | 2026-10-03 (observada) | Sola: cron diario 06:45 |
| FIE · `fie_historico` | Mundial | 2003–2024 | — | 332 | 141.551 | 100 % | 141.575 | 99,98 % | 36.257 | F/E/S · M/F | ABS, M20, M17, VET | 2026-10-06 (observada, día de carga) | Lote (lote 8) |
| EFC · `efc_ranking` | Continental (Europa) | 2009-10–2026-27 | 2020-21 | 137 | 44.617 | 100 % | 66.311 | 67,3 % | 19.567 | F/E/S · M/F | M23, M17, M14 | 2026-10-06 (observada) | Lote (lote 8) |
| RFEE · `skermo_ranking` (España) | Nacional | 2012-13–2026-27 | 2016-17 | 411 | 31.686 | 72,8 % | 31.686 | 72,8 % | 5.226 | F/E/S · M/F | ABS, M20, M17, M15, M14, M13, VET | 2026-10-06 (322 observadas, 89 de la fuente) | Sola: cron 05:30 con cadencia propia. 2012-13 a 2015-16 cargadas por lote desde Wayback (lote 10) |
| FFE · `ffe_classement` (Francia) | Nacional | 2022-23–2026-27 | — | 97 | 7.464 | 100 % | 36.051 | 20,7 % | 1.526 | F/E/S · M/F | ABS, M20, M17, M15 | 2026-10-06 (de la fuente) | Lote (lote 8) |
| FIS · `fis_ranking` (Italia) | Nacional | 2017-18–2026-27 | — | 210 | 24.306 | 100 % | 89.204 | 27,2 % | 2.154 | F/E/S · M/F | ABS, M23, M20, M17 | 2026-10-05 (de la fuente) | Lote (lote 8) |
| FAHK · `hkfa_ranking` (Hong Kong) | Nacional | 2025-26 | sólo 1 temporada | 18 | 443 | 100 % | 919 | 48,2 % | 258 | F/E/S · M/F | ABS, M20, M17 | 2026-10-06 (observada) | Lote (lote 8) |
| MVSZ · `mvsz_ranglista` (Hungría) | Nacional | 2013-14–2026-27 | — | 264 | 12.281 | 100 % | 18.156 | 67,6 % | 1.336 | F/E/S · M/F | ABS, M23, M20, M17 | 2026-10-06 (observada) | Lote (lote 8) |
| BF · `bf_ranking` (Gran Bretaña) | Nacional | 2019-20–2026-27 | 2020-21 | 180 | 8.468 | 100 % | 28.117 | 30,1 % | 1.079 | F/E/S · M/F | ABS, M23, M20, M17, M14 | 2026-10-01 (de la fuente) | Lote (lote 10) |
| CFF · `cff_ranking` (Canadá) | Nacional | 2021-22–2025-26 | falta 2026-27 | 120 | 2.562 | 100 % | 14.321 | 17,9 % | 413 | F/E/S · M/F | ABS, M20, M17, M15 | 2026-10-07 (observada) | Lote (lote 10) |
| AFF · `aff_ranking` (Australia) | Nacional | 2026-27 | sólo 1 temporada | 18 | 355 | 100 % | 1.117 | 31,8 % | 227 | F/E/S · M/F | ABS, M20, M17 | 2026-10-07 (de la fuente) | Lote (lote 11) |
| ÖFV · `oefv_rangliste` (Austria) | Nacional | 2008-09–2025-26 | 2010-11, 2011-12, 2015-16, 2018-19, 2019-20 y 2026-27 | 220 | 3.480 | 100 % | 6.583 | 52,9 % | 412 | F/E/S · M/F | ABS, M20, M17 | 2026-10-07 (observada) | Lote (lote 11) |
| FRS · `frs_ranking` (Rumanía) | Nacional | 2024-25 | sólo 1 temporada; sin sénior | 12 | 402 | 100 % | 786 | 51,1 % | 261 | F/E/S · M/F | M20, M17 | 2025-02-03 (de la fuente) | Lote (lote 11) |
| TEF · `tef_klasman` (Turquía) | Nacional | 2026-27 | sólo 1 temporada | 24 | 692 | 100 % | 2.455 | 28,2 % | 363 | F/E/S · M/F | ABS, M20, M17, M14 | 2026-09-29 (de la fuente) | Lote (lote 11) |
| ČSŠ · `css_zebricek` (República Checa) | Nacional | 2021-22–2026-27 | — | 144 | 2.976 | 100 % | 7.529 | 39,5 % | 358 | F/E/S · M/F | ABS, M20, M17, M15 | 2026-10-06 (de la fuente) | Lote (lote 11b) |
| KNAS · `knas_ranglijst` (Países Bajos) | Nacional | 2025-26–2026-27 | — | 29 | 208 | 100 % | 745 | 27,9 % | 135 | F/E/S · M/F | ABS, M23, M20, M17, M14 | 2026-09-01 (de la fuente) | Lote (lote 11b) |
| FVE · `fve_clasificacion` (Venezuela) | Nacional | 2025-26 | sólo 1 temporada | 18 | 23 | 100 % | 776 | 3,0 % | 18 | F/E/S · M/F | ABS, M20, M17 | 2026-10-07 (observada) | Lote (lote 11b) |
| БФФ · `bff_ranglista` (Bulgaria) | Nacional | 2025-26 | sólo 1 temporada | 26 | 430 | 100 % | 936 | 45,9 % | 230 | F/E/S · M/F | ABS, M23, M20, M17, M15, M14 | 2026-10-07 (observada) | Lote (lote 11b) |
| **Total** | | | | **2.367** | **322.753** | **87,7 %** | | | | | | | |
| USA Fencing · `usa_points` (Estados Unidos) — **lote 13, pendiente de aplicar** | Nacional | 2009-10–2026-27 | 2012-13 (no está en el archivo); 2009-10 sólo 2 listas | 269 | 15.338 | 100 % | 28.693 | 53,5 % | 2.447 | F/E/S · M/F | ABS, M20, M17 | 2026-09-28 (de la fuente) | Lote (lote 13) |
| FS · `sgp_ranking` (Singapur) — **lote 13, pendiente de aplicar** | Nacional | 2019-20–2025-26 | 2026-27 todavía sin lista | 126 | 2.635 | 100 % | 6.512 | 40,5 % | 290 | F/E/S · M/F | ABS, M20, M17 | 2026-08-12 (de la fuente) | Lote (lote 13) |
| FPE · `fpe_ranking` (Portugal) — **lote 13, pendiente de aplicar** | Nacional | 2026-27 | sólo 1 temporada (la fuente sólo publica la vigente) | 18 | 146 | 100 % | 417 | 35,0 % | 95 | F/E/S · M/F | ABS, M20, M17 | 2026-10-07 (observada) | Lote (lote 13) |
| ÖFV · `oefv_rangliste` (Austria) — **ampliación lote 13, pendiente de aplicar** | Nacional | 2006-07, 2007-08, 2010-11 y 2011-12 | quedan 2015-16, 2018-19 y 2019-20 | 68 | 978 | 100 % | 2.229 | 43,9 % | 216 | F/E/S · M/F | ABS, M20, M17 | 2026-10-07 (observada) | Lote (lote 13) |

Las cuatro filas del lote 13 son lo generado en `calendario-trabajo\rankings-lote13-int`
(29 ficheros, 19.097 entradas, comprobados con `--comprobar`); no están en
producción ni se suman al total. La copia `nuevo14.sqlite` con la que se
generaron sólo tiene `fie_tiradores`, `skermo_ranking`, `bf_ranking` y
`cff_ranking` (818 listas, 78.842 filas), no las 2.367 listas de esta tabla:
conviene confirmar qué tandas anteriores siguen pendientes de aplicar.

Notas:

- **FIE**: las dos fuentes juntas cubren 2003–2027 sin huecos; 2024 está en las
  dos. `fie_tiradores` guarda la lista entera (no sólo las filas vinculadas) y
  es la única fuente con listas por equipos. Su última lectura es del 3/10;
  la ingesta automática estuvo pausada durante los lotes 11 a 12.
- **RFEE**: la temporada 2016-17 no tiene listas. Las capturas de Wayback de esa
  temporada que encontró el lote 10 eran listas de mitad de temporada (por
  ejemplo, 2 pruebas de 6), y el informe de `rankings-lote10-rfee-web` también
  descartó 69 versiones anteriores y 11 documentos que no eran el ranking
  nacional. RFEE es la única nacional con M13 y VET.
- **EFC**: sólo publica rankings de categorías inferiores y sub-23 (M23, M17 y
  M14); no tiene un ranking absoluto.
- **FRS**: el lector indica que no se publica ranking sénior (sólo cadete y
  júnior).
- En los informes, el motivo principal de las filas sin vínculo es
  `sin_candidata`: la persona no existe en la base porque nunca ha tirado una
  prueba indexada.

## Cobertura de los tiradores internacionales por país

Personas con resultados FIE o EFC, por `sport_person.country_code`.
«Con nacional» cuenta la aparición en cualquier lista nacional cargada, sea o
no la de su país. Se muestran los 45 países con más tiradores.

| País | Con resultados internacionales | Con algún ranking | Con lista nacional | Sin ningún ranking | Fuente nacional propia |
|---|---:|---:|---:|---:|---|
| FRA | 3.018 | 2.924 | 1.527 (50,6 %) | 94 | FFE |
| ITA | 2.995 | 2.932 | 2.154 (71,9 %) | 63 | FIS |
| USA | 2.826 | 2.582 | 0 | 244 | USA Fencing (lote 13, pendiente) |
| GER | 2.641 | 2.491 | 0 | 150 | **no** (descartada) |
| sin país | 2.019 | 253 | 250 | 1.766 | — |
| GBR | 1.985 | 1.956 | 1.079 (54,4 %) | 29 | BF |
| HUN | 1.947 | 1.866 | 1.336 (68,6 %) | 81 | MVSZ |
| POL | 1.860 | 1.804 | 0 | 56 | **no** (descartada) |
| RUS | 1.533 | 1.354 | 0 | 179 | **no** |
| JPN | 1.403 | 1.259 | 0 | 144 | **no** (descartada) |
| ESP | 1.329 | 1.315 | 1.009 (75,9 %) | 14 | RFEE |
| TUR | 1.215 | 1.193 | 363 (29,9 %) | 22 | TEF |
| CAN | 1.145 | 1.087 | 413 (36,1 %) | 58 | CFF |
| KOR | 1.125 | 884 | 2 | 241 | **no** (descartada) |
| UKR | 1.089 | 1.029 | 0 | 60 | **no** (descartada) |
| CHN | 1.022 | 773 | 0 | 249 | **no** (descartada) |
| ROU | 899 | 879 | 261 (29,0 %) | 20 | FRS |
| SWE | 814 | 792 | 0 | 22 | **no** (descartada) |
| GRE | 774 | 748 | 0 | 26 | **no** (descartada) |
| SUI | 699 | 664 | 0 | 35 | **no** (descartada) |
| EGY | 680 | 559 | 0 | 121 | **no** (descartada) |
| HKG | 675 | 625 | 258 (38,2 %) | 50 | FAHK |
| BUL | 627 | 593 | 230 (36,7 %) | 34 | БФФ |
| ISR | 603 | 583 | 0 | 20 | **no** (descartada) |
| CZE | 575 | 568 | 358 (62,3 %) | 7 | ČSŠ |
| AUS | 574 | 544 | 190 (33,1 %) | 30 | AFF |
| AUT | 569 | 560 | 412 (72,4 %) | 9 | ÖFV |
| MEX | 538 | 476 | 0 | 62 | no |
| BEL | 529 | 505 | 0 | 24 | no |
| IRI | 515 | 470 | 0 | 45 | no (descartada) |
| IND | 496 | 365 | 0 | 131 | no (descartada) |
| SGP | 477 | 446 | 1 | 31 | FS (lote 13, pendiente) |
| NED | 471 | 453 | 135 (28,7 %) | 18 | KNAS |
| VEN | 466 | 414 | 18 (3,9 %) | 52 | FVE |
| COL | 464 | 366 | 0 | 98 | no |
| TPE | 449 | 367 | 0 | 82 | no (descartada) |
| POR | 449 | 430 | 0 | 19 | FPE (lote 13, pendiente) |
| DEN | 428 | 408 | 0 | 20 | no |
| FIN | 416 | 388 | 0 | 28 | no |
| KAZ | 408 | 347 | 0 | 61 | no (descartada) |
| BRA | 403 | 352 | 0 | 51 | no |
| UZB | 341 | 280 | 0 | 61 | no |
| BLR | 341 | 292 | 0 | 49 | no |
| EST | 312 | 302 | 0 | 10 | no |
| SRB | 310 | 305 | 0 | 5 | no |

## Fuentes descartadas

Los `informe.json` sólo describen las fuentes cargadas. Los motivos de los
descartes salen de los informes de las tandas de rankings de los lotes 11 y 12
(7 de octubre); los sondeos están en `calendario-trabajo\lote11-tmp\p`.

| País | Tiradores internacionales en la base | Motivo |
|---|---:|---|
| Japón | 1.403 | La lista es pública y `robots.txt` lo permite, pero los nombres vienen sólo en kanji y en la base están en alfabeto latino: no se pueden vincular. |
| Grecia, Suecia, Bélgica, Brasil, Dinamarca, Noruega, Finlandia e Irlanda | 774, 814, 529, 403, 428, … | Publican sus rankings en `fencing.ophardt.online`, cuyo `robots.txt` lo prohíbe todo (`Disallow: /`). |
| Ucrania | 1.089 | Las listas son enlaces a la vista previa de Google Drive; la descarga directa la prohíbe `robots.txt` y la vista previa no trae el texto. |
| Israel | 603 | Los puntos están en podiumcomp.com, detrás de un desafío de Cloudflare (403) que no se fuerza; los XLSX de fencing.org.il dan 404. |
| China | 1.022 | La API publica los nombres sólo en caracteres chinos, sin pinyin. |
| Egipto | 680 | Los nombres vienen sólo en árabe. |
| México | 538 | No hay ranking público en la web de la federación. |
| Colombia | 464 | El servidor de la federación no resuelve. |
| Argentina | — | Página de verificación anti-bots; la federación de la Ciudad de Buenos Aires no es nacional. |
| Nueva Zelanda | — | La web corta la conexión y el portal de resultados está detrás de Cloudflare. Entra en parte por la lista australiana (AFF). |
| Alemania | 2.641 | fechten.org («Wettkampf & Ranglisten») sólo enlaza a `fencing.ophardt.online`, cuyo `robots.txt` lo prohíbe todo. (Lote 13.) |
| Suiza | 699 | swiss-fencing.ch enlaza la lista CNS a `fencing.ophardt.online` (prohibido por `robots.txt`). (Lote 13.) |
| Polonia | 1.860 | `pzszerm.pl/zawody/klasyfikacje/` devolvía 500/502 y, cuando respondió, era una página de comprobación anti-bots con JavaScript (cookie y píxel); no se fuerza. (Lote 13.) |
| Corea | 1.125 | fencing.sports.or.kr no tiene lista de ranking; las puntuaciones de selección se publican como avisos y los nombres vienen sólo en hangul. (Lote 13.) |
| Taipéi | 449 | fencing.org.tw no publica un ranking nacional y los nombres vienen en caracteres chinos. (Lote 13.) |
| India | 496 | fencingindia.org no publica ranking nacional (sólo resultados y perfiles). (Lote 13.) |
| Kazajistán | 408 | fencing.kz ya no es de la federación; kazfencing.kz no publica ranking (y escribe los nombres en cirílico). (Lote 13.) |
| Irán | 515 | irfencing.ir, irfencing.com y fencing.ir no responden. (Lote 13.) |

Rusia y Bielorrusia compiten como neutrales: no se buscan.

Notas del lote 13 sobre las fuentes nuevas:

- **USA Fencing**: los puntos del sistema nuevo están en `member.usafencing.org`,
  que `robots.txt` prohíbe. Se usan las «National Rolling Point Standings»
  (sistema anterior): el directorio `usfencingresults.org/rankings/` que
  incrusta la página «Point Standings» (`Crawl-delay: 10`, respetado) y los zip
  de cada temporada de `usafencing.org/rankings-archive`. De cada zip se toma,
  por arma, género y categoría, la última lista cuya cabecera es de esa
  temporada (las últimas de cada zip suelen ser ya de la siguiente). 2012-13
  no está en el archivo; de 2009-10 sólo hay dos listas con nombre legible;
  las anteriores no se han leído. Lleva año de nacimiento, que entra en el
  vínculo, y el país de los de fuera.
- **Fencing Singapore**: formulario GET público con temporadas desde 2019; la
  fecha es la del cálculo («as at»).
- **FPE**: sólo existe la lista vigente (la entrada y el PDF se sustituyen). La
  temporada es la del título («2026/2027»), aunque las pruebas que suma son de
  2025-26; lleva año de nacimiento.
- **ÖFV**: se leen ahora las temporadas con el texto girado 90° (2006-07,
  2007-08 y 2011-12) y la de 2010-11, cuya cabecera escribe la «N» de
  «Nachname» como carácter de control. 2015-16 tiene una fuente Type3 sin
  texto legible y 2018-19 y 2019-20 son imágenes: necesitarían OCR.

## Qué falta

1. **Federaciones sin lista nacional** (Estados Unidos, Singapur y Portugal
   tienen ya la suya generada en el lote 13, pendiente de aplicar; Alemania,
   Polonia, Corea y Suiza se han descartado, ver arriba), ordenadas por número
   de tiradores internacionales: Estados Unidos (2.826), Alemania (2.641), Polonia (1.860),
   Rusia (1.533), Japón (1.403), Corea (1.125), Ucrania (1.089), China (1.022),
   Suecia (814), Grecia (774), Suiza (699), Egipto (680), Israel (603), México
   (538) y Bélgica (529). Estados Unidos, China, Corea, Rusia, Alemania, Japón,
   India y Egipto concentran además la mayoría de los tiradores sin ningún
   ranking.
2. **Personas sin país**: 1.766 de los 5.716 tiradores internacionales sin
   ranking no tienen `country_code`.
3. **Huecos de temporada**:
   - EFC y Gran Bretaña: 2020-21. No existe: los XLSX de la EFC de 2020-21
     salen vacíos (sólo la cabecera) y el mapa del sitio de British Fencing no
     tiene ninguna lista entre agosto de 2020 y julio de 2021 (temporada del
     covid). (Lote 13.)
   - Austria: 2010-11 y 2011-12 generadas en el lote 13; quedan 2015-16,
     2018-19 y 2019-20 (sin texto legible) y la temporada en curso (el archivo
     sólo tiene temporadas cerradas);
   - RFEE: 2016-17;
   - Canadá: 2026-27 todavía no publicada. La página de rankings sólo tiene
     hasta «2025-2026 Season End Rankings» y la aplicación
     `ranking.fencing.ca` publica aún la 2025-26 (su API `rankingapi.fencing.ca`
     responde 500 a `robots.txt`, así que no se usa). (Lote 13.)
4. **Historia corta**: Australia, Rumanía, Turquía, Hong Kong, Venezuela y
   Bulgaria tienen una sola temporada, y Países Bajos tiene dos. En el lote 13
   no se ha podido ampliar: todas publican sólo la lista vigente (Rumanía
   sustituye los mismos PDF de 2021 con la lista de 2024-25). Las versiones
   anteriores sólo estarían en Wayback, que no se ha intentado.
5. **Vínculo bajo con lo publicado**: Venezuela (3 %), Canadá (17,9 %),
   Francia (20,7 %), Italia (27,2 %), Países Bajos (27,9 %) y Turquía (28,2 %).
   La causa principal es que la persona no está en la base (`sin_candidata`).
6. **Actualización**: las 16 fuentes cargadas por lote no se refrescan solas.
   La temporada 2026-27 que tienen varias (EFC, FFE, FIS, MVSZ, BF, AFF, TEF,
   ČSŠ y KNAS) se quedará atrasada si no se repite la carga o no se programa
   una tarea.
