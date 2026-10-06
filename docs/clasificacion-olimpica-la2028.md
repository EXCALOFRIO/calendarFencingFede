# Clasificación olímpica de esgrima: Los Ángeles 2028

Fuente oficial (manda sobre todo lo demás):

- COI / FIE, *Qualification System – Games of the XXXIV Olympiad – LA28 –
  Fencing*, **versión del 17 de septiembre de 2026** (9 páginas):
  <https://stillmed.olympics.com/media/Documents/Olympic-Games/LA28/FEN-LA28-Qualification-System.pdf>
- Hubo un borrador previo de la FIE para su Congreso de 2025, en
  `static.fie.org/uploads/37/`. Lo sustituye el documento anterior.
- Para comparar, el sistema de París 2024 (el modelo anterior):
  <https://en.wikipedia.org/wiki/Fencing_at_the_2024_Summer_Olympics_%E2%80%93_Qualification>

**Estado:** las reglas de LA 2028 **están publicadas y son definitivas**. Lo
que es *provisional* es la clasificación que enseña la aplicación: se calcula
con el último ranking FIE sénior guardado, no con el ranking del 1 de abril de
2028, que es el único que cuenta. Por eso la interfaz lleva la pastilla
«Provisional» con la fecha del ranking usado.

El motor que aplica estas reglas está en `src/lib/ranking/olimpica/`.

## Pruebas y cupos (B)

- 12 pruebas: florete, espada y sable, individual y por equipos, masculino y
  femenino.
- 212 plazas por género (204 por clasificación + 6 de anfitrión + 1 de
  universalidad), 424 en total.
- Máximo por CON: **9 tiradores por género, 1 equipo de 3 por prueba de
  equipos**, y nunca más de **3 tiradores por arma** (D.2, último párrafo).
- Individual: mínimo 34 tiradores (24 de los 8 equipos + 10 por la vía
  individual), máximo **37** (anfitrión y universalidad).
- Equipos: 8 equipos por prueba, 9 si el anfitrión mete uno.

## Periodo y ranking que cuenta (D, H)

| Fecha | Hito |
|---|---|
| 1 abr 2027 | Empieza el periodo de clasificación |
| 1 abr 2028 | **Cierre de los rankings oficiales FIE sénior** (los que deciden) |
| 12–30 abr 2028 | Torneos zonales de clasificación |
| 30 abr 2028 | Fin del periodo |
| 8 may 2028 | La FIE publica y confirma por escrito las plazas |
| 19 may 2028 | El anfitrión dice si usa sus plazas y en qué pruebas |
| 31 may 2028 | Los CON confirman el uso de las plazas |
| 1 jun 2028 | La FIE reasigna las plazas no confirmadas |
| 25–26 jun 2028 | Nombres de los equipos; cierre de inscripciones |

- **Equipos:** *FIE Official Senior Team Ranking List* del 1 de abril de 2028
  (art. o.109): Copas del Mundo por equipos, Mundial y campeonatos
  continentales entre el 1 abr 2027 y el 1 abr 2028.
- **Individual:** *FIE Individual Senior Adjusted Official Ranking (AOR)* del
  1 de abril de 2028, que es el ranking oficial individual (art. o.108: Grand
  Prix, Copas del Mundo, satélites, Mundial y continentales) **ajustado**:
  1. se quitan todos los tiradores de los CON que tienen equipo clasificado
     en esa arma;
  2. de los demás CON, solo queda el mejor de cada uno.

## Equipos (D.1): 8 por prueba

1. Los **4 primeros** del ranking por equipos, sea cual sea su zona.
2. El **mejor equipo de cada una de las cuatro zonas FIE** (África, América,
   Asia-Oceanía, Europa) **entre los puestos 5.º y 24.º**.
3. Si una zona no tiene equipo en esos puestos, la plaza pasa al **siguiente
   equipo mejor clasificado, sea de la zona que sea**.

(París 2024 usaba el tramo 5.º–16.º; en LA 2028 es 5.º–24.º.)

## Individual (D.2): 10 por prueba, máximo 1 por CON sin equipo

- Los **3 tiradores de cada equipo clasificado** entran también en el
  individual de su arma (24 por arma; no cuentan en las 10 plazas).
- **2 plazas por el AOR mundial:** los dos mejores del AOR, máximo uno por CON.
- **4 plazas por el AOR por zona:** el mejor del AOR de cada zona (Europa,
  Asia-Oceanía, América, África), solo para CON que no tengan ya a nadie en esa
  arma por equipos ni por el AOR mundial.
- **4 plazas por los torneos zonales** (una por zona), solo para CON que no
  tengan a nadie clasificado en esa arma por las vías anteriores.

(París 2024 repartía 6 por zonas —2 Europa, 2 Asia-Oceanía, 1 América,
1 África— sin plazas mundiales; en LA 2028 son 2 mundiales + 1 por zona.)

## Anfitrión (D.3) y universalidad (D.4)

- Estados Unidos (USA) tiene **6 plazas** además de las que gane, repartidas
  como quiera respetando los máximos por CON y por prueba. Meter un equipo le
  cuesta 2 plazas si ya tiene un tirador en ese individual, 3 si no; los tres
  del equipo hacen también el individual.
- 2 plazas de universalidad (1 por género) que asigna la Comisión Tripartita.

## Reasignación (F)

- AOR mundial → siguiente del AOR cuyo CON no tenga a nadie en esa arma.
- AOR por zona → siguiente de la misma zona en el AOR, con la misma condición.
- Torneo zonal → siguiente del mismo torneo, con la misma condición.
- Equipo de los 4 primeros → siguiente equipo del ranking.
- Equipo por zona → siguiente equipo de la misma zona.
- Plazas de anfitrión sin usar → reparto entre FIE (al siguiente del AOR, en
  cualquier arma y zona) y Comisión Tripartita (universalidad), según una
  tabla de 6 a 1 plazas sobrantes.

## Desempates

El documento **no define desempates propios**: se usa el puesto que publica la
FIE en su ranking. Cuando dos equipos o tiradores tienen el mismo puesto en el
límite de una plaza, el motor mantiene el orden que publica la FIE (puesto, y a
igualdad de puesto, más puntos primero) y lo marca como **empate** (diferencia
de 0 puntos con el primero que se queda fuera). Lo que la FIE decida en ese caso
no se adivina.

## Lo que el motor NO calcula (y por qué)

- **Torneos zonales:** dependen de un torneo de abril de 2028. Se enseñan como
  4 plazas por decidir.
- **Plazas de anfitrión y universalidad:** las reparte el CON de EE. UU. o la
  Comisión Tripartita a su criterio. Se enseña si USA ya está dentro por
  ranking.
- **Elegibilidad:** la participación de **Rusia (RUS) y Bielorrusia (BLR)** en
  LA 2028 no está decidida. Decisión de producto: sus filas se enseñan en el
  ranking, pero **no ocupan plaza** (el cálculo se hace sin ellas) y se marcan
  «pendiente», con lo que tendrían si contaran. Los tiradores con país `FIE`
  (neutrales) tampoco ocupan plaza. Está en `PENDIENTES_LA2028`
  (`reglas.ts`); la opción `nocsNoElegibles` permite cambiarlo.
- **Reasignaciones por renuncia:** las decide la FIE después de mayo de 2028.

## Zonas FIE

La zona de cada país sale de la confederación continental a la que pertenece
su federación (EFC → Europa, CPE → América, CAE → África, FCA y Oceanía →
Asia-Oceanía). La tabla está en `src/lib/ranking/olimpica/zonas.ts`; la base de
datos no guarda la zona.
