# Clasificación olímpica de esgrima: Los Ángeles 2028

## Fuentes

Fuente oficial (manda sobre todo lo demás):

- **[QS]** COI / FIE, *Qualification System – Games of the XXXIV Olympiad –
  LA28 – International Fencing Federation (FIE) – Fencing*, **«Version as of
  17 September 2026»**, 9 páginas.
  <https://stillmed.olympics.com/media/Documents/Olympic-Games/LA28/FEN-LA28-Qualification-System.pdf>
  Leído el 7 de octubre de 2026 (el servidor da `last-modified: 17 Sep 2026`).
  Sustituye a la versión «as of 12 May 2026», que todavía sale en los
  buscadores. El borrador de la FIE para su Congreso de 2025
  (`static.fie.org/uploads/37/185509-14. draft - QS- Fencing - …`) ya no está
  publicado (404 el 7/10/2026).
- **[PAR]** Para comparar con París 2024:
  <https://en.wikipedia.org/wiki/Fencing_at_the_2024_Summer_Olympics_%E2%80%93_Qualification>
  (consultado el 7/10/2026).

Cada regla de abajo lleva su sección del documento oficial ([QS] §… y página).

**Estado:** las reglas de LA 2028 están publicadas. Lo que es *provisional* es
la clasificación que enseña la aplicación: se calcula con el último ranking FIE
sénior guardado, no con el del 1 de abril de 2028, que es el único que cuenta.
Por eso la burbuja lleva la pastilla «Provisional» con la fecha del ranking.

El motor que aplica estas reglas está en `src/lib/ranking/olimpica/`.

## Pruebas y plazas

| Regla | Valor | Fuente |
|---|---|---|
| Pruebas | 12: florete, espada y sable, individual y por equipos, masculino y femenino | [QS] §A, p. 1 |
| Plazas por clasificación | 102 hombres + 102 mujeres = **204** | [QS] §B.1, p. 1 |
| Plazas de anfitrión | **6 en total** (no por género) | [QS] §B.1 y §D.3, pp. 1 y 6 |
| Plazas de universalidad | 1 hombre + 1 mujer = 2 | [QS] §B.1 y §D.4, pp. 1 y 6 |
| **Total** | **212** (los dos géneros juntos) | [QS] §B.1, p. 1 |
| Máximo por CON | 9 tiradores por género (18 en total) y 1 equipo de 3 por prueba de equipos | [QS] §B.2, p. 1 |
| Cupo por prueba | 1 equipo de 3 o 1 tirador en la individual (si no tiene equipo) | [QS] §B.2, p. 2 |
| Máximo por arma | 3 tiradores de un CON, «under any circumstances» | [QS] §D.2, p. 5 |
| Individual | mínimo 34 (24 de los 8 equipos + 10 por la vía individual), máximo 37 | [QS] §B.3, p. 2 |
| Equipos | 8 por prueba; 9 si el anfitrión mete uno con sus plazas | [QS] §B.3, p. 2 |
| Plazas con nombre | 60 (10 por prueba individual, de 10 CON distintos) | [QS] §B.4, p. 3 y §D.2, p. 4 |
| Plazas al CON | 144 de equipos (48 equipos) y las 6 del anfitrión | [QS] §B.4, p. 3 |

Comparado con París 2024 ([PAR]): mismo total (212), mismas 12 pruebas, mismo
cupo por CON y mismo rango de 34 a 37 por individual. Cambian las dos vías de
abajo (tramo de equipos y reparto de las plazas individuales por ranking).

## Periodo y ranking que cuenta ([QS] §D.1, §D.2 y §H, pp. 4–5 y 9)

| Fecha | Hito |
|---|---|
| 1 abr 2027 | Empieza el periodo de clasificación |
| 1 oct 2027 | El COI invita a pedir plazas de universalidad (plazo: 15 ene 2028) ([QS] §D.4) |
| 1 abr 2028 | **Cierre de los rankings oficiales FIE sénior** (los que deciden) |
| 12–30 abr 2028 | Torneos zonales de clasificación |
| 30 abr 2028 | Fin del periodo |
| 8 may 2028 | La FIE publica y confirma por escrito las plazas |
| 19 may 2028 | El anfitrión dice si usa sus plazas y en qué pruebas |
| 21–25 may 2028 | Plazo para confirmar las plazas de universalidad |
| 31 may 2028 | Los CON confirman el uso de las plazas (medianoche GMT+1) |
| 1 jun 2028 | La FIE reasigna las plazas no confirmadas |
| 25 jun 2028 | Nombres de los tres de cada equipo y de los suplentes «Ap» |
| 26 jun 2028 | Cierre de inscripciones |
| 14–30 jul 2028 | Juegos |

- **Equipos:** *FIE Official Senior Team Ranking List* del 1 de abril de 2028
  (art. o.109): Copas del Mundo por equipos, Mundial y campeonatos
  continentales entre el 1 abr 2027 y el 1 abr 2028 ([QS] §D.1, p. 4).
- **Individual:** *FIE Individual Senior Adjusted Official Ranking (AOR)* del
  1 de abril de 2028 ([QS] §D.2, pp. 4–5). Es el ranking oficial individual
  (art. o.108: Grand Prix, Copas del Mundo, satélites, Mundial y continentales,
  del 1 abr 2027 al 1 abr 2028) **ajustado**:
  1. se quitan todos los tiradores de los CON que tienen equipo clasificado
     en esa arma;
  2. de los demás CON, solo queda el mejor de cada uno (por CON, por zona y
     por arma).

## Equipos: 8 por prueba ([QS] §D.1, p. 4)

1. Los **4 primeros** del ranking por equipos, sea cual sea su zona.
2. El **mejor equipo de cada una de las cuatro zonas FIE** (África, América,
   Asia-Oceanía, Europa) **entre los puestos 5.º y 24.º**. Cuenta aunque su
   zona ya tenga un equipo entre los 4 primeros.
3. Si una zona no tiene equipo en esos puestos, la plaza pasa al **siguiente
   equipo mejor clasificado, sea de la zona que sea**.

París 2024 usaba el tramo 5.º–16.º ([PAR]).

## Individual: 10 por prueba, máximo 1 por CON sin equipo ([QS] §D.2, pp. 4–5)

- Los **3 tiradores de cada equipo clasificado** hacen también el individual
  de su arma: 24 por arma, que no cuentan en las 10 plazas. Los elige el CON.
- **2 plazas por el AOR:** los dos mejores del AOR, máximo uno por CON.
- **4 plazas por el AOR por zona:** el mejor del AOR de cada zona (Europa,
  Asia-Oceanía, América, África), solo para CON que no tengan ya a nadie en
  esa arma por equipos ni por el AOR.
- **4 plazas por los torneos zonales** (una por zona; solo el mejor de cada
  CON), solo para CON que no tengan a nadie clasificado en esa arma por las
  vías anteriores.

París 2024 repartía 6 plazas por el AOR por zona (2 Europa, 2 Asia-Oceanía,
1 América, 1 África) y ninguna por el AOR mundial ([PAR]). En LA 2028 son
2 por el AOR + 1 por zona.

## Anfitrión ([QS] §D.3, p. 6) y universalidad ([QS] §D.4, p. 6)

- Estados Unidos (USA) tiene **6 plazas** además de las que gane, repartidas
  entre pruebas individuales y por equipos como quiera, respetando los máximos
  por CON y por prueba. Meter un equipo le cuesta 2 plazas si ya tiene un
  tirador en ese individual, 3 si no; los tres del equipo hacen también el
  individual.
- 2 plazas de universalidad (1 por género) que asigna la Comisión Tripartita
  al acabar el periodo.

## Reasignación ([QS] §F, pp. 7–8)

Siempre respetando los máximos por CON y por prueba (§B):

- AOR → siguiente del AOR cuyo CON no tenga a nadie en esa arma.
- AOR por zona → siguiente de la misma zona en el AOR, con la misma condición.
- Torneo zonal → siguiente del mismo torneo, con la misma condición.
- Equipo de los 4 primeros → siguiente equipo del ranking.
- Equipo por zona → siguiente equipo de la misma zona.
- Plazas de anfitrión sin usar (F.2): 6 → 3 FIE + 3 Tripartita; 5 → 2 + 3;
  4 → 2 + 2; 3 → 1 + 2; 2 → 1 + 1; 1 → 0 + 1. Las de la FIE van al siguiente
  del AOR del 1 de abril de 2028 en cualquier arma y zona; las de la Tripartita,
  a más universalidad. En ambos casos sin pasar de 37 en el individual y solo
  a CON sin tirador en esa prueba.
- Universalidad sin asignar (F.3) → la FIE, al siguiente del AOR, con las
  mismas condiciones.

## Desempates

El documento **no define desempates propios**: se usa el puesto que publica la
FIE en su ranking. Cuando dos equipos o tiradores tienen el mismo puesto en el
límite de una plaza, el motor mantiene el orden que publica la FIE (puesto y, a
igualdad, más puntos primero) y lo marca como **empate** (diferencia de 0
puntos con el primero que se queda fuera).

## Lo que enseña la aplicación

Cada fila del ranking internacional sénior lleva, como mucho, una marca:

| Color | Estado | Quién |
|---|---|---|
| Verde | `clasificado` | Tendría plaza hoy: los 8 equipos, los 3 mejores del ranking de cada CON con equipo, los 2 del AOR y el mejor de cada zona en el AOR. **30 tiradores por prueba** (34 plazas − 4 de torneo zonal). |
| Amarillo | `cerca` («Por asegurar») | El **primer reserva** de cada camino, es decir, quien heredaría la plaza si el último que entra por ese camino la perdiera (el orden de reasignación de §F.1): el siguiente equipo del ranking, el siguiente equipo de cada zona, el siguiente del AOR y el siguiente de cada zona en el AOR; también los 3 mejores tiradores de un equipo reserva. Además **no le puede faltar más de un tercio de los puntos** de quien tiene que pasar. Y los 3 mejores de USA en un arma donde no tenga plaza (anfitrión). |
| Gris | `pendiente` | RUS y BLR que serían verdes o amarillos si contaran. |
| Nada | | Todos los demás, incluidos los que solo tienen el torneo zonal. |

Con la copia de producción del 7/10/2026 (temporada 2027 del ranking FIE),
por prueba individual:

| Prueba | Verde | Amarillo | Gris | Equipos verde / amarillo |
|---|---|---|---|---|
| Florete masc. | 30 | 9 | 3 | 8 / 3 |
| Florete fem. | 30 | 8 | 1 | 8 / 2 |
| Espada masc. | 30 | 9 | 0 | 8 / 3 |
| Espada fem. | 30 | 5 | 0 | 8 / 1 |
| Sable masc. | 30 | 5 | 3 | 8 / 2 |
| Sable fem. | 30 | 8 | 3 | 8 / 2 |

Los parámetros están en `REGLAS_LA2028` (`reglas.ts`) y en
`RESERVAS_POR_CAMINO` y `FALTA_MAXIMA_CERCA` (`anotar.ts`).

## Lo que el motor NO calcula (y por qué)

- **Torneos zonales:** dependen de un torneo de abril de 2028. Son 4 plazas por
  prueba sin calcular.
- **Plazas de anfitrión y universalidad:** las reparte el CON de EE. UU. o la
  Comisión Tripartita a su criterio.
- **Quién de cada equipo:** el CON elige a sus tres; el motor marca a los tres
  mejor clasificados del ranking individual.
- **Elegibilidad:** la participación de **Rusia (RUS) y Bielorrusia (BLR)** en
  LA 2028 no está decidida. Decisión de producto: sus filas se enseñan, pero
  **no ocupan plaza** (el cálculo se hace sin ellas, y los tramos «5.º a 24.º»
  se cuentan sin ellas) y se marcan «pendiente», con lo que tendrían si
  contaran. Los tiradores con país `FIE` (neutrales) tampoco ocupan plaza.
  Está en `PENDIENTES_LA2028` (`reglas.ts`); la opción `nocsNoElegibles`
  permite cambiarlo.
- **Reasignaciones por renuncia:** las decide la FIE a partir del 1 de junio de
  2028.

## Zonas FIE

La zona de cada país sale de la confederación continental a la que pertenece
su federación (EFC → Europa, CPE → América, CAE → África, FCA y Oceanía →
Asia-Oceanía). Israel, Turquía, Chipre y el Cáucaso son Europa; Kazajistán y
Asia central, Asia-Oceanía. La tabla está en
`src/lib/ranking/olimpica/zonas.ts`; la base de datos no guarda la zona.
