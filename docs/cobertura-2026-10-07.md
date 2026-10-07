# Cobertura de pruebas celebradas tras el lote 11 (7 de octubre de 2026)

Medición sobre `nuevo12.sqlite` (copia exacta de producción tras el lote 11, abierta sólo en
lectura) con `scripts/indexado/cobertura-base.ts`, que usa el universo y los criterios de
`cobertura.ts` (FIE sin marcadores; EFC del circuito y su inventario; RFEE = catálogo nacional de
Skermo y lecturas nacionales, sin autonómicas). Celebrada = fecha ≤ 7/10/2026. «Aplica» sigue las
reglas de `cobertura.ts`: poules en individual salvo eliminación directa, cuadro con dos o más
participantes salvo poule única.

```powershell
node node_modules/tsx/dist/cli.mjs scripts/indexado/cobertura-base.ts --db <calendario-trabajo>\nuevo12.sqlite --hoy 2026-10-07 --previstas lote12-efc-engarde,lote12-efc-fww
```

El lote 11 apenas mueve la cobertura (una prueba RFEE más): fue sobre todo calidad de PDF y
uniones. Con esta medición, `nuevo11` daba 12.552 pruebas, 93,2 % con clasificación y 57,1 %
completas. Las cifras del 7/10 (93,1 % y 56,3 %; FIE ≤2013-14 13,4 %, RFEE 70,6 %) salen de una
medición anterior y no son directamente comparables.

## Resumen por organismo

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| EFC | 677 | 669 (98,8 %) | 310/362 (85,6 %) | 532/677 (78,6 %) | 532 (78,6 %) |
| FIE ≤2013-14 | 4.779 | 4.371 (91,5 %) | 456/3.660 (12,5 %) | 868/4.756 (18,3 %) | 707 (14,8 %) |
| FIE ≥2014-15 | 4.402 | 4.361 (99,1 %) | 2.547/2.791 (91,3 %) | 4.000/4.402 (90,9 %) | 3.988 (90,6 %) |
| RFEE | 2.695 | 2.303 (85,5 %) | 1.844/2.322 (79,4 %) | 1.951/2.570 (75,9 %) | 1.945 (72,2 %) |
| **Total** | 12.553 | 11.704 (93,2 %) | 5.157/9.135 (56,5 %) | 7.351/12.405 (59,3 %) | 7.172 (57,1 %) |

## Previsión con el lote 12 preparado (`lote12-efc-engarde` y `lote12-efc-fww`)

Sólo cambia la EFC: el cuadro pasa de 532 a 562 pruebas (78,6 % → 83,0 % completas), y el total
pasa de 7.172 a 7.202 pruebas completas (57,4 %).

## Estados en `sport_import_coverage` (filas por fuente y tipo de hecho)

| Fuente | Hecho | completo | parcial | sin_resultados | otros |
|---|---|---:|---:|---:|---|
| fie | ranking (clasificación) | 8.515 | 216 | 59 | pendiente 425, conflicto 1 |
| fie | pools | 2.494 | 513 | 6.208 | |
| fie | tableau | 4.416 | 452 | 4.348 | |
| efc | results | 436 | 233 | | |
| efc | pools | 170 | 140 | 357 | |
| efc | tableau | 388 | 144 | 135 | |
| engarde | results | 1.145 | 35 | 66 | |
| engarde | pools | 812 | 130 | 304 | |
| engarde | tableau | 862 | 166 | 218 | |
| rfee_pdf | results | 907 | 66 | 180 | |
| rfee_pdf | pools | 380 | 186 | 522 | |
| rfee_pdf | tableau | 498 | 89 | 532 | |
| skermo_rfee | results | 940 | 3 | | conflicto 3 |
| skermo_rfee | pools | 540 | 99 | 5 | |
| skermo_rfee | tableau | 463 | 172 | 5 | |

## Por organismo y modalidad

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| EFC equipos | 316 | 315 (99,7 %) | 0/1 (0,0 %) | 234/316 (74,1 %) | 234 (74,1 %) |
| EFC individual | 361 | 354 (98,1 %) | 310/361 (85,9 %) | 298/361 (82,5 %) | 298 (82,5 %) |
| FIE ≤2013-14 equipos | 1.094 | 1.017 (93,0 %) | 0/0 (–) | 526/1.094 (48,1 %) | 526 (48,1 %) |
| FIE ≤2013-14 individual | 3.685 | 3.354 (91,0 %) | 456/3.660 (12,5 %) | 342/3.662 (9,3 %) | 181 (4,9 %) |
| FIE ≥2014-15 equipos | 1.593 | 1.559 (97,9 %) | 0/0 (–) | 1.424/1.593 (89,4 %) | 1.424 (89,4 %) |
| FIE ≥2014-15 individual | 2.809 | 2.802 (99,8 %) | 2.547/2.791 (91,3 %) | 2.576/2.809 (91,7 %) | 2.564 (91,3 %) |
| RFEE equipos | 645 | 422 (65,4 %) | 230/272 (84,6 %) | 345/586 (58,9 %) | 358 (55,5 %) |
| RFEE individual | 2.050 | 1.881 (91,8 %) | 1.614/2.050 (78,7 %) | 1.606/1.984 (80,9 %) | 1.587 (77,4 %) |

## Por organismo y arma

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| EFC ? | 3 | 0 (0,0 %) | 0/3 (0,0 %) | 0/3 (0,0 %) | 0 (0,0 %) |
| EFC ESPADA | 253 | 251 (99,2 %) | 114/132 (86,4 %) | 194/253 (76,7 %) | 194 (76,7 %) |
| EFC FLORETE | 212 | 210 (99,1 %) | 99/114 (86,8 %) | 169/212 (79,7 %) | 169 (79,7 %) |
| EFC SABLE | 209 | 208 (99,5 %) | 97/113 (85,8 %) | 169/209 (80,9 %) | 169 (80,9 %) |
| FIE ESPADA | 3.226 | 3.076 (95,4 %) | 1.064/2.315 (46,0 %) | 1.671/3.224 (51,8 %) | 1.609 (49,9 %) |
| FIE FLORETE | 3.043 | 2.893 (95,1 %) | 1.011/2.129 (47,5 %) | 1.629/3.032 (53,7 %) | 1.570 (51,6 %) |
| FIE SABLE | 2.912 | 2.763 (94,9 %) | 928/2.007 (46,2 %) | 1.568/2.902 (54,0 %) | 1.516 (52,1 %) |
| RFEE ESPADA | 935 | 782 (83,6 %) | 664/809 (82,1 %) | 675/913 (73,9 %) | 668 (71,4 %) |
| RFEE FLORETE | 879 | 758 (86,2 %) | 575/755 (76,2 %) | 626/835 (75,0 %) | 624 (71,0 %) |
| RFEE SABLE | 881 | 763 (86,6 %) | 605/758 (79,8 %) | 650/822 (79,1 %) | 653 (74,1 %) |

## FIE por temporada

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| 2002-2003 | 347 | 312 (89,9 %) | 4/253 (1,6 %) | 0/346 (0,0 %) | 0 (0,0 %) |
| 2003-2004 | 322 | 278 (86,3 %) | 16/254 (6,3 %) | 10/322 (3,1 %) | 10 (3,1 %) |
| 2004-2005 | 313 | 302 (96,5 %) | 20/248 (8,1 %) | 0/313 (0,0 %) | 0 (0,0 %) |
| 2005-2006 | 390 | 330 (84,6 %) | 35/288 (12,2 %) | 18/390 (4,6 %) | 9 (2,3 %) |
| 2006-2007 | 411 | 399 (97,1 %) | 27/305 (8,9 %) | 83/411 (20,2 %) | 82 (20,0 %) |
| 2007-2008 | 377 | 325 (86,2 %) | 39/291 (13,4 %) | 95/377 (25,2 %) | 83 (22,0 %) |
| 2008-2009 | 374 | 326 (87,2 %) | 83/287 (28,9 %) | 91/374 (24,3 %) | 84 (22,5 %) |
| 2009-2010 | 382 | 357 (93,5 %) | 80/294 (27,2 %) | 97/382 (25,4 %) | 86 (22,5 %) |
| 2010-2011 | 336 | 310 (92,3 %) | 32/240 (13,3 %) | 95/336 (28,3 %) | 75 (22,3 %) |
| 2011-2012 | 347 | 291 (83,9 %) | 16/256 (6,3 %) | 116/347 (33,4 %) | 72 (20,7 %) |
| 2012-2013 | 360 | 342 (95,0 %) | 47/252 (18,7 %) | 123/360 (34,2 %) | 99 (27,5 %) |
| 2013-2014 | 358 | 345 (96,4 %) | 26/256 (10,2 %) | 134/356 (37,6 %) | 100 (27,9 %) |
| 2014-2015 | 439 | 429 (97,7 %) | 242/284 (85,2 %) | 365/439 (83,1 %) | 365 (83,1 %) |
| 2015-2016 | 411 | 405 (98,5 %) | 244/269 (90,7 %) | 375/411 (91,2 %) | 374 (91,0 %) |
| 2016-2017 | 433 | 432 (99,8 %) | 249/265 (94,0 %) | 401/433 (92,6 %) | 401 (92,6 %) |
| 2017-2018 | 403 | 395 (98,0 %) | 240/265 (90,6 %) | 369/403 (91,6 %) | 363 (90,1 %) |
| 2018-2019 | 393 | 387 (98,5 %) | 244/250 (97,6 %) | 370/393 (94,1 %) | 370 (94,1 %) |
| 2019-2020 | 255 | 249 (97,6 %) | 151/175 (86,3 %) | 219/255 (85,9 %) | 219 (85,9 %) |
| 2020-2021 | 64 | 64 (100,0 %) | 42/42 (100,0 %) | 64/64 (100,0 %) | 64 (100,0 %) |
| 2021-2022 | 320 | 318 (99,4 %) | 172/199 (86,4 %) | 289/320 (90,3 %) | 284 (88,8 %) |
| 2022-2023 | 415 | 415 (100,0 %) | 235/259 (90,7 %) | 385/415 (92,8 %) | 385 (92,8 %) |
| 2023-2024 | 408 | 407 (99,8 %) | 232/245 (94,7 %) | 380/408 (93,1 %) | 380 (93,1 %) |
| 2024-2025 | 411 | 410 (99,8 %) | 219/244 (89,8 %) | 368/411 (89,5 %) | 368 (89,5 %) |
| 2025-2026 | 414 | 414 (100,0 %) | 247/264 (93,6 %) | 379/414 (91,5 %) | 379 (91,5 %) |
| 2026-2027 | 36 | 36 (100,0 %) | 30/30 (100,0 %) | 36/36 (100,0 %) | 36 (100,0 %) |
| ≤2001-2002 | 462 | 454 (98,3 %) | 31/436 (7,1 %) | 6/442 (1,4 %) | 7 (1,5 %) |

## EFC por temporada

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| 2017-2018 | 90 | 90 (100,0 %) | 51/53 (96,2 %) | 81/90 (90,0 %) | 81 (90,0 %) |
| 2018-2019 | 100 | 100 (100,0 %) | 47/58 (81,0 %) | 79/100 (79,0 %) | 79 (79,0 %) |
| 2019-2020 | 104 | 104 (100,0 %) | 52/58 (89,7 %) | 88/104 (84,6 %) | 88 (84,6 %) |
| 2021-2022 | 65 | 63 (96,9 %) | 31/34 (91,2 %) | 51/65 (78,5 %) | 51 (78,5 %) |
| 2022-2023 | 93 | 91 (97,8 %) | 42/49 (85,7 %) | 75/93 (80,6 %) | 75 (80,6 %) |
| 2023-2024 | 102 | 101 (99,0 %) | 36/48 (75,0 %) | 75/102 (73,5 %) | 75 (73,5 %) |
| 2024-2025 | 103 | 103 (100,0 %) | 41/49 (83,7 %) | 77/103 (74,8 %) | 77 (74,8 %) |
| 2025-2026 | 13 | 13 (100,0 %) | 8/8 (100,0 %) | 4/13 (30,8 %) | 4 (30,8 %) |
| 2026-2027 | 4 | 4 (100,0 %) | 2/2 (100,0 %) | 2/4 (50,0 %) | 2 (50,0 %) |
| ? | 3 | 0 (0,0 %) | 0/3 (0,0 %) | 0/3 (0,0 %) | 0 (0,0 %) |

## RFEE por temporada

| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |
|---|---:|---:|---:|---:|---:|
| 2013-2014 | 16 | 16 (100,0 %) | 10/10 (100,0 %) | 16/16 (100,0 %) | 16 (100,0 %) |
| 2014-2015 | 42 | 41 (97,6 %) | 27/28 (96,4 %) | 40/42 (95,2 %) | 39 (92,9 %) |
| 2015-2016 | 51 | 51 (100,0 %) | 24/26 (92,3 %) | 49/51 (96,1 %) | 49 (96,1 %) |
| 2016-2017 | 79 | 79 (100,0 %) | 46/47 (97,9 %) | 79/79 (100,0 %) | 78 (98,7 %) |
| 2017-2018 | 73 | 72 (98,6 %) | 46/50 (92,0 %) | 65/72 (90,3 %) | 62 (84,9 %) |
| 2018-2019 | 209 | 168 (80,4 %) | 100/172 (58,1 %) | 123/203 (60,6 %) | 127 (60,8 %) |
| 2019-2020 | 138 | 97 (70,3 %) | 71/120 (59,2 %) | 81/135 (60,0 %) | 82 (59,4 %) |
| 2020-2021 | 113 | 101 (89,4 %) | 81/84 (96,4 %) | 94/111 (84,7 %) | 94 (83,2 %) |
| 2021-2022 | 181 | 159 (87,8 %) | 145/147 (98,6 %) | 147/173 (85,0 %) | 146 (80,7 %) |
| 2022-2023 | 332 | 279 (84,0 %) | 192/297 (64,6 %) | 188/299 (62,9 %) | 190 (57,2 %) |
| 2023-2024 | 347 | 278 (80,1 %) | 219/309 (70,9 %) | 207/314 (65,9 %) | 206 (59,4 %) |
| 2024-2025 | 359 | 290 (80,8 %) | 270/323 (83,6 %) | 265/348 (76,1 %) | 261 (72,7 %) |
| 2025-2026 | 353 | 284 (80,5 %) | 226/309 (73,1 %) | 226/328 (68,9 %) | 226 (64,0 %) |
| 2026-2027 | 22 | 8 (36,4 %) | 18/20 (90,0 %) | 8/21 (38,1 %) | 8 (36,4 %) |
| ≤2012-2013 | 380 | 380 (100,0 %) | 369/380 (97,1 %) | 363/378 (96,0 %) | 361 (95,0 %) |

## Huecos y su causa

Pruebas no completas en `nuevo12`: 5.381 (lista en `calendario-trabajo\cobertura\huecos-nuevo12.json`).

### RFEE (750 pruebas)

Clasificación en `calendario-trabajo\lote12-tmp\rfee-clases-nuevo12.json`, que cruza cada hueco
con lo ya buscado en los lotes 8c (`cobertura\lote8c-huecos.json`) y 10
(`hechos\lote10-rfee-engarde-wayback\_informe-engarde-wayback.json`) y con las pruebas de la base.

| Causa | Ind. | Eq. | Total |
|---|---:|---:|---:|
| PDF de la RFEE sin esas fases legibles (lector de PDF, otro trabajo) | 61 | 138 | 199 |
| Sin documento publicado ni archivado (Skermo sin documento, Engarde y Wayback sin capturas) | 109 | 67 | 176 |
| La fuente publica sólo una parte (Engarde o Skermo sin cuadro o sin poules; ligas sólo con poules) | 53 | 74 | 127 |
| Veteranos: los asaltos están en la prueba de otro tramo de edad del mismo día (no es hueco de fuente) | 122 | 0 | 122 |
| Un solo tirador en la clasificación (no puede haber poule) | 64 | 0 | 64 |
| No celebrada o sin prueba propia (aplazadas, silla sin categoría femenina, filas genéricas) | 48 | 7 | 55 |
| Recuperadas en lotes anteriores que siguen incompletas | 6 | 1 | 7 |

Los 122 de veteranos son tramos de edad pequeños (2-5 tiradores) que se tiraron juntos con otro
tramo en una sola prueba de Engarde (`cespvet2026/vet-ef-30-40`, `tlm_cor/…`): la unificación
fundió la lectura de Engarde con uno de los dos tramos de Skermo y el otro se quedó sin asaltos y
sin fila en `sport_competition_combined`. Se arregla enlazando esas partes como pruebas conjuntas
(`dedupe-conjuntas.ts`, regla «partes»), no buscando fuentes. Con eso y los 64 de un solo
tirador, la RFEE pasaría de 72,2 % a cerca de 79 % completas.

### EFC (145 pruebas)

| Grupo | Pruebas | Causa | Lote 12 |
|---|---:|---|---|
| Engarde 2025-26 y Sofía 2024 (Segovia, Budapest Cup) | 9 | El cuadro nuevo de Engarde escribe «nombre NAC» en las rondas siguientes y el lector no casaba al ganador | preparado (`lote12-efc-engarde`) |
| Fencing Worldwide: equipos (Copenhague, Núremberg 2024, Klagenfurt, Heidenheim, Bonn, Tauberbischofsheim, Salónica 2026) y PDF de Ophardt con identificador FWW (Gotemburgo 2024, Kneipp Cup, Goldenes Florett) | 21 | El cuadro estaba publicado en `/direct/<n>` y no se había leído | preparado (`lote12-efc-fww`) |
| Fencing Worldwide, Núremberg 2022, 2023 y 2025 | 6 | FWW trunca «UNITED STATES OF AMERI»: varios equipos con el mismo nombre; el cuadro sale incoherente y no se escribe | no recuperable sin otra fuente |
| PDF de FencingTime (Konin, Poznań, Varsovia, Cracovia, Bratislava, Bucarest, Estambul, Zrenjanin, Espoo, Manchester, Mödling, Satu Mare…) | 74 | Poules sin marcador y cuadro sin nombres en la capa de texto; FencingTimeLive pide sesión desde 2026 y la Wayback sólo tiene capturas de Poznań 2023 y de un cuadro de Konin 2025, sin lector de FTL | formato ilegible o fuente privada |
| PDF de Engarde por equipos (Gödöllő, Grenoble, Nápoles, Budapest 2018 y 2021, Moscú, Cabriès) y dos individuales | 19 | El lector de PDF de la EFC sólo lee clasificación y poules individuales; las páginas HTML de Engarde de esos torneos no están en la búsqueda internacional | sin lector de cuadro por equipos en PDF |
| PDF de Ophardt sin identificador de FWW (Salónica 2022) | 2 | El lector de PDF de Ophardt no lee el cuadro; el nombre del PDF no da su identificador en FWW y Ophardt Online prohíbe todo en `robots.txt` | sin lector, fuente cerrada |
| Engarde Camden 2018 | 4 | Engarde publica sólo la clasificación | la fuente no publica |
| XML de la EFC por equipos (Copenhague 2021) | 2 | El XML no trae encuentros | la fuente no publica |
| Pendientes del inventario EFC sin XML y pruebas sin clasificación (Budapest 2021, Poznań 2023, Barcelona 2024, torneos 917 y 1024) | 8 | Sin documento capturado | sin fuente |

### FIE

| Tramo | Falta | Pruebas | Causa |
|---|---|---:|---|
| ≤2013-14 individual | poules y cuadro | 2.689 | La FIE sólo publica la clasificación final; Fencing Worldwide empieza en 2015; Ophardt prohíbe todo en `robots.txt`; Engarde en la Wayback, Olympedia y las páginas de fie.ch ya se usaron en los lotes 7 y 10 |
| ≤2013-14 individual | sólo cuadro o sólo poules | 484 | Igual: lecturas parciales de Ophardt, PDF de la FIE o Engarde |
| ≤2013-14 individual | todo | 331 | Sin clasificación publicada (pueden estar anuladas) |
| ≤2013-14 equipos | cuadro (o todo) | 568 | La API de la FIE no da encuentros por equipos de esas temporadas |
| ≥2014-15 individual | poules y/o cuadro (7 sin nada) | 245 | Lo buscado en los lotes 5, 7 y 10 (Ophardt, FencingTime, FWW, Engarde) |
| ≥2014-15 equipos | cuadro (o todo) | 169 | Cuadros FIE sin rondas o sin publicar |

No se ha encontrado una fuente pública nueva para la FIE anterior a 2014-15: es el límite de la
fuente.

## Preparado para el lote 12 (sin cargar)

| Carpeta (`calendario-trabajo\hechos\`) | Pruebas | Puestos | Asaltos de poule | Asaltos o encuentros de cuadro |
|---|---:|---:|---:|---:|
| `lote12-efc-engarde` | 9 | 1.431 | 3.510 (ya cargadas, se repiten) | 1.139 |
| `lote12-efc-fww` | 21 | 1.023 | 1.665 (ya cargadas, se repiten) | 871 |

- `lote12-efc-engarde` (`scripts/indexado/lote12-efc-engarde.ts`): Segovia 2026 (2 individuales
  y 2 por equipos), Budapest Cup 2025 (2 individuales y espada masculina por equipos) y Sofía 2024
  (2 por equipos). Se vuelve a leer la misma prueba de Engarde limpiando la nación del cuadro
  (`quitarNacionEnCuadro`, de `lote8c-engarde`). Claves de edición y prueba, puestos y `factKey`
  son los del fichero de `lote7-efc`: la clasificación coincide al 100 %, y las poules son las
  mismas que ya están cargadas.
- `lote12-efc-fww` (`scripts/indexado/lote12-efc-fww.ts`): 17 cuadros por equipos y 4
  individuales. Sólo añade encuentros del cuadro; los puestos y las poules son los del fichero
  previo (`lote7-efc` o `lote8b-efc-pdf`). Los cuadros de equipos quedan como `parcial` porque
  FWW publica los encuentros por puestos (5.º-8.º…) en rondas que no se leen.
- Las dos carpetas pasan `validarPrueba` (marcadores posibles y cuadro coherente). Se cargan con
  `cargar-hechos.ts --carpetas lote12-efc-engarde,lote12-efc-fww`.
- Peticiones: 66 + 12 contra engarde-service.com y fencingworldwide.com (ninguna publica
  `robots.txt`), con un máximo de 2 a la vez por host y 800 ms entre ellas. Caché en
  `calendario-trabajo\cache-lote12-efc`.
