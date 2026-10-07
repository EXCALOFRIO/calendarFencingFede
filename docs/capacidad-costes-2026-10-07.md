# Capacidad, costes y rendimiento (7 de octubre de 2026)

Informe para decidir con números: cuánto ha mejorado la aplicación, cuánto
gasta, cuánta gente aguanta a la vez, cuánto piden las tareas programadas y
cuánto espacio queda.

Fuentes:

- Las mediciones de rendimiento salen del arnés `tests/perf/rutas.mts`, en
  `calendario-trabajo\perf\rutas\`. Se tomó la línea base de la fase 1
  (`antes.json`) y la de la fase 2 (`f2\antes\`), y la pasada final
  (`final\despues.json`, copia `nuevo11`). La búsqueda, las sugerencias y el
  ranking del seleccionador se midieron después de optimizarlos
  (`ola3\antes.json` y `ola3\despues.json`).
- La matriz de dispositivos está en `capturas\matriz\`.
- Los precios proceden de developers.cloudflare.com, consultado el 7/10/2026.
  Las páginas de precios de Workers y de Workers AI están actualizadas a 2 y
  1 de octubre de 2026.
- El almacenamiento se consultó en producción el 7/10/2026, sólo con lecturas.
- La configuración sale de `wrangler.jsonc`, `src/lib/cron/programado.ts`,
  `src/lib/ingest/resultados-auto/config.ts` y `docs/tareas-programadas.md`.

## Resumen

| Pregunta | Respuesta corta |
|---|---|
| ¿Ha mejorado? | Sí. Con la caché llena, las pantallas principales leen de D1 entre un 95 % y un 100 % menos filas (el perfil, por ejemplo, pasa de 172.742 a 74). La búsqueda, ya optimizada, lee lo mismo que en la fase 1 (+8 %) sobre un índice mucho mayor. |
| ¿Cuánto cuesta hoy? | 5 $/mes. Todo cabe en lo incluido en el plan. |
| ¿Cuándo se pasa de 5 $? | Con uso típico (2 visitas al día), hacia los 1.250 usuarios activos, y por céntimos. Con uso intenso (10 visitas al día), hacia los 250. Lo primero que se agota es la CPU, no D1. |
| ¿Cuánto con 20.000 usuarios? | Unos 24 $/mes con uso típico y unos 227 $/mes con uso intenso. Ahora pesan más la CPU, las peticiones y los logs que D1. |
| ¿Cuántos usuarios a la vez? | Unos 1.000 en una estimación conservadora y entre 5.000 y 9.000 en una optimista. El límite es D1, que es una sola base y atiende las consultas de una en una. |
| ¿Y la colocación inteligente? | `placement: smart` ya está en `wrangler.jsonc` y se activará con el próximo despliegue. Cloudflare ejecutará el Worker cerca de la base, así que cada consulta a D1 debería tardar menos en llegar y volver. Se notará sobre todo en las cargas en frío, que encadenan decenas de consultas (un perfil sin caché, hasta unas 45). |
| ¿Cuánto piden los crons? | 28 invocaciones del Worker al día y como mucho unas 1.150 peticiones a fuentes externas (unas 420 en un día normal). |
| ¿Cuánto espacio queda? | D1 ocupa el 21 % de sus 10 GB, R2 el 5 % de los 10 GB gratuitos y KV casi nada. El límite real es el libro de capacidad, que va por el 75 % de los 8 GiB: da para entre 1 y 8 meses de ingesta automática. |

---

## 1. Rendimiento antes y después

### Qué es «caché fría» y «caché caliente»

Muchas pantallas muestran datos que son iguales para todo el mundo: el perfil
deportivo de un tirador, una edición, las tablas de ranking o el calendario.
La aplicación guarda ese resultado ya calculado. Primero lo guarda en la
memoria del Worker y después en KV, que lo comparte en todo el mundo.

- **Fría**: es la primera visita después de que cambian los datos (por
  ejemplo, tras la ingesta nocturna). El resultado no está guardado, así que
  hay que preguntarle a D1.
- **Caliente**: son todas las visitas siguientes. El resultado ya está
  guardado y D1 sólo se consulta para lo personal: tu sesión, tus favoritos
  y tus inscripciones.

Mientras se recalcula una entrada caducada, se sigue mostrando la versión
anterior, así que el usuario no espera. Por eso lo que cuenta para el coste
es la cifra en caliente. La fría se paga una vez por pantalla y por cada
versión de los datos.

### Consultas y filas leídas por pantalla

Cada celda indica consultas / filas leídas de D1. «Antes» es la línea base de
la fase 1 (copia `nuevo9`, sin caché, D1 en cada visita). Para la ficha de
evento y el trimestre anterior se usa la de la fase 2, porque la fase 1 no
los medía. «Después» es la pasada final (copia `nuevo11`).

| Pantalla | Antes | Después, fría | Después, caliente | Filas, caliente frente a antes |
|---|---:|---:|---:|---:|
| Armazón (sesión + menú, en **cada** página) | 7 / 1.011 | 8 / 26 | 4 / 6 | −99 % |
| Calendario, mes actual | 26 / 9.137 | 20 / 8.480 | 3 / 6 | −100 % |
| Calendario, mes pasado (marzo 2019) | 17 / 7.535 | 5 / 1.240 | 3 / 6 | −100 % |
| Calendario, cargar trimestre anterior | 11 / 4.384 | 9 / 4.363 | 0 / 0 | −100 % |
| Ficha de evento (detalle, inscritos, resultados) | 14 / 15.494 | 13 / 15.477 | 2 / 6 | −100 % |
| Perfil Llavador (todas las pestañas) | 54 / 172.742 | 65 / 108.171 | 12 / 74 | −100 % |
| Perfil Zabala (todas las pestañas) | 55 / 138.909 | 66 / 75.421 | 13 / 77 | −100 % |
| Perfil Ranvier (todas las pestañas) | 54 / 129.623 | 64 / 64.739 | 12 / 53 | −100 % |
| Edición Mundial 2026 (FIE) | 8 / 51.969 | 7 / 10.852 | 0 / 0 | −100 % |
| Edición TNR 3-10-2026 (Skermo) | 8 / 44.024 | 7 / 2.918 | 0 / 0 | −100 % |
| Cara a cara: elegir rival | 6 / 23.698 | 6 / 17.025 | 0 / 0 | −100 % |
| Cara a cara: Llavador contra un rival | 18 / 4.770 | 18 / 4.704 | 0 / 0 | −100 % |
| Ranking del tirador (nacional + mundial) | 17 / 49.648 | 14 / 19.400 | 7 / 22 | −100 % |
| Ranking, vista de seleccionador (nacional) | 15 / 35.378 | 7 / 626 | 5 / 8 | −100 % |
| Ranking mundial: cambiar de tabla | 5 / 5.003 | 8 / 19.783 | 5 / 5.003 | 0 % |
| Explorar vacío (propuestas) | 12 / 63.595 | 12 / 11.618 | 11 / 128 | −100 % |
| Inicio vacío (cuenta que no sigue a nadie) | 6 / 11.519 | 5 / 29 | 6 / 31 | −100 % |
| Inicio de quien sigue a 20 personas | 1 / 5.112 | 1 / 5.112 | 1 / 5.112 | 0 % (sin caché: es personal) |
| Buscar «zabala» | 3 / 873 | 9 / 16.022 | 4 / 946 | ≈ igual que la fase 1 (+8 %; ver nota) |
| Sugerencias mientras se escribe (por tecla) | 2 / 1.058 | 3 / 1.151 | 3 / 1.151 | ≈ igual que la fase 1 (+9 %; ver nota) |

En los perfiles, «después» suma las cinco secciones con caché: cabecera y
resultados, estadísticas, rivales, curiosidades y ranking.

**La búsqueda, ya optimizada.** Tras la pasada final, la búsqueda y las
sugerencias por tecla leían unas 13.000 filas por petición: 12.693 al buscar
y 12.921 por tecla. El cambio posterior en
`src/lib/sport/explorar/olimpica-perfil.ts` las deja en 946 y 1.151 filas
(−93 % y −91 %), según `ola3\despues.json`. Es casi lo mismo que en la fase 1
(873 y 1.058, +8 % y +9 %). La diferencia es que ahora se busca en un índice
mucho mayor: `nuevo11` tiene el índice de Explorar completo y muchas más
personas que `nuevo9`. En el mismo cambio, el ranking nacional del
seleccionador (`src/lib/queries/ranking.ts`) pasó de 509 a 8 filas en
caliente.

**Lo que queda por mejorar.**

- **Inicio de quien sigue a otras personas.** Con 20 personas seguidas lee
  5.112 filas en cada visita. Es personal y no tiene caché, y ahora es lo que
  más pesa en las filas de D1 por pantalla (apartado 2).
- **Ranking mundial al cambiar de tabla.** Sigue leyendo 5.003 filas.
- **Tiempo de motor de la búsqueda.** Las filas han bajado mucho, pero el
  tiempo de motor medido en local casi no ha cambiado: 17 ms al buscar y unos
  10 ms por tecla (apartado 3).

### Tiempo de D1 y tiempo en el arnés

El arnés mide en local. Cada viaje a la base cuesta allí entre 1 y 40 ms, así
que los milisegundos sirven para comparar entre sí, no son lo que verá un
usuario. El «motor» es el tiempo que D1 pasa ejecutando SQL, y es lo que
limita la concurrencia (apartado 3).

| Pantalla | Arnés antes | Arnés, caliente | Motor D1 antes | Motor D1, caliente |
|---|---:|---:|---:|---:|
| Calendario, mes actual | 2.221 ms | 251 ms | 10 ms | 1 ms |
| Perfil Llavador | 4.446 ms | 950 ms | 415 ms | 2 ms |
| Ficha de evento | 1.042 ms | 160 ms | – | 0 ms |
| Edición Mundial 2026 | 639 ms | 6 ms | 40 ms | 0 ms |
| Cara a cara elegir rival | 646 ms | 1 ms | 160 ms | 0 ms |
| Explorar vacío | 1.004 ms | 828 ms | 80 ms | 2 ms |
| Buscar «zabala» (tras optimizar) | 248 ms | 329 ms | 8 ms | 17 ms |
| Sugerencias por tecla (tras optimizar) | 155 ms | 243 ms | 6 ms | 10 ms |

### Primera pintura (FCP) en la matriz de dispositivos

La matriz recorre 33 páginas en 24 variantes de dispositivo (móviles, tabletas
y escritorio, en tema claro y oscuro y con el texto al 130 %). En total son
792 capturas, contra un servidor local con la copia `nuevo11`. **No mide LCP**:
sólo FCP (primera pintura) y CLS (saltos de diseño).

| Medida | Línea base (`linea-base.json`, 06:21) | Después (`comparacion-linea-base.md`) |
|---|---:|---:|
| Capturas | 792 | 792 |
| Mediana de FCP | 500 ms | – (no se guardó el JSON completo) |
| Percentil 90 de FCP | 1.776 ms | – |
| Capturas con FCP > 1,8 s | 79 | 77 |
| Capturas con saltos de diseño (CLS > 0,1) | 2 | 3 |
| Puntos de fallo totales (todas las reglas) | 1.987 | 287 (−86 %) |

Mediana de FCP por zona en la línea base: calendario 1.364 ms, ficha de
evento 908 ms, Explorar 636 ms, prueba 500 ms, perfil 444 ms, ranking 440 ms
y cara a cara 424 ms.

Hay un aviso. El `informe.json` actual (12:40) recoge una repetición parcial
de 429 capturas. Da una mediana de 1.216 ms porque el ordenador estaba
cargado (el calendario tardó 464 s, frente a 203 s en la línea base). No es
una regresión de la aplicación, pero tampoco sirve como «después». La medida
fiable de primera pintura, y la de LCP, es una pasada contra producción con
`PERF_URL` (`docs/rendimiento.md` §9).

---

## 2. Consumo y coste mensual en Cloudflare

### Precios y cuotas vigentes (Workers Paid, octubre de 2026)

| Servicio | Incluido en los 5 $/mes | Precio por encima |
|---|---|---|
| Peticiones al Worker | 10 millones/mes | 0,30 $ por millón |
| CPU del Worker | 30 millones de ms/mes | 0,02 $ por millón de ms |
| Ficheros estáticos (`/_next/static`, `public`) | ilimitados y gratis | – |
| Workers Logs (`observability` está activado) | 20 millones de eventos/mes | 0,60 $ por millón |
| D1, filas leídas | 25.000 millones/mes | 0,001 $ por millón |
| D1, filas escritas | 50 millones/mes | 1,00 $ por millón |
| D1, almacenamiento | 5 GB | 0,75 $ por GB y mes |
| KV, lecturas | 10 millones/mes | 0,50 $ por millón |
| KV, escrituras, borrados y listados | 1 millón/mes cada uno | 5,00 $ por millón |
| KV, almacenamiento | 1 GB | 0,50 $ por GB y mes |
| R2 (Standard) | 10 GB, 1 millón de operaciones A y 10 millones de B al mes | 0,015 $/GB; 4,50 $ y 0,36 $ por millón de operaciones |
| Workers AI | 10.000 neuronas/día | 0,011 $ por 1.000 neuronas |
| Imágenes (`next/image`, plan Images gratuito) | 5.000 transformaciones únicas al mes | Con el plan gratuito no se cobra: las transformaciones nuevas fallan (error 9422) hasta el mes siguiente |
| Rate Limiting (binding `ratelimits`) | la documentación no le pone precio | – |
| Cron Triggers | 250 por cuenta (se usan 10) | Sólo cuentan como peticiones y CPU del Worker |

Límites que importan:

- D1: 10 GB por base, 1.000 consultas por invocación y 30 s por consulta.
  Cada base atiende una consulta cada vez.
- Worker: 128 MB de memoria por isolate y CPU por petición configurada en
  30 s (`limits.cpu_ms`).
- Un cron que se dispara una vez por hora o con menos frecuencia tiene hasta
  15 minutos de CPU.
- Las réplicas de lectura de D1 no tienen coste extra.

### Perfil de consumo por pantalla (supuestos)

| Concepto | Valor usado | De dónde sale |
|---|---:|---|
| Peticiones al Worker por pantalla | 4 | 1 documento o RSC, unas 2 precargas de enlaces y 1 imagen o API. Los ficheros estáticos no cuentan. |
| CPU por petición | 20 ms de media | Supuesto: renderizado de Next.js en el servidor. Cloudflare da 10-20 ms como típico de una página renderizada. **Hay que comprobarlo** en Workers Observability. |
| Lecturas de KV por pantalla | 2 | Supuesto pesimista: la memoria del isolate sirve casi todo. |
| Filas de D1 por pantalla, caliente | ≈ 1.250 | Media ponderada de las mediciones: 30 % calendario (12), 25 % perfil (80), 15 % ranking (28), 15 % inicio (5.118), 10 % búsqueda ya optimizada (946 + 3 teclas × 1.151 = 4.399) y 5 % fichas (12). Da 1.236 filas, de las que 768 son del inicio y 440 de la búsqueda. |
| Filas de D1 por pantalla, cargas en frío repartidas | + 1.000 | Recargas tras cada cambio de datos. |
| Total de D1 por pantalla | **≈ 2.250 filas** | Con la búsqueda sin optimizar eran unas 7.000. |
| Escrituras por pantalla | ≈ 0 | Las pantallas medidas no escriben. Escriben las acciones: seguir, favoritos y notificaciones leídas. |

Escenarios de uso por usuario activo y mes, en temporada:

- **Típico**: 2 visitas al día de 5 pantallas, 30 días → 300 pantallas. Cada
  usuario genera 1.200 peticiones, 24.000 ms de CPU, 600 lecturas de KV y
  675.000 filas de D1.
- **Intenso** (el propuesto, 10 visitas al día de 5 pantallas): 1.500
  pantallas. Cada usuario genera 6.000 peticiones, 120.000 ms de CPU, 3.000
  lecturas de KV y 3,4 millones de filas de D1.

A eso se suma un fondo fijo de tareas programadas: unas 870 invocaciones al
mes, entre 1 y 3 millones de ms de CPU y alrededor de un millón de filas
escritas como máximo (apartado 4).

### Coste estimado al mes

**Uso típico (300 pantallas por usuario y mes)**

| Usuarios activos/mes | Peticiones | CPU (ms) | Filas leídas D1 | Lecturas KV | Eventos de log (×1,2) | Coste total |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0,12 M | 2,4 M | 68 M | 0,06 M | 0,14 M | **5,00 $** |
| 1.000 | 1,2 M | 24 M | 675 M | 0,6 M | 1,4 M | **5,00 $** |
| 5.000 | 6 M | 120 M (+1,80 $) | 3.375 M | 3 M | 7,2 M | **6,80 $** |
| 20.000 | 24 M (+4,20 $) | 480 M (+9,00 $) | 13.500 M | 12 M (+1,00 $) | 28,8 M (+5,28 $) | **≈ 24 $** |

**Uso intenso (1.500 pantallas por usuario y mes)**

| Usuarios activos/mes | Peticiones | CPU (ms) | Filas leídas D1 | Lecturas KV | Eventos de log (×1,2) | Coste total |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0,6 M | 12 M | 338 M | 0,3 M | 0,7 M | **5,00 $** |
| 1.000 | 6 M | 120 M (+1,80 $) | 3.375 M | 3 M | 7,2 M | **6,80 $** |
| 5.000 | 30 M (+6,00 $) | 600 M (+11,40 $) | 16.875 M | 15 M (+2,50 $) | 36 M (+9,60 $) | **≈ 35 $** |
| 20.000 | 120 M (+33,00 $) | 2.400 M (+47,40 $) | 67.500 M (+42,50 $) | 60 M (+25,00 $) | 144 M (+74,40 $) | **≈ 227 $** |

Las filas leídas de D1 se dan en millones (25.000 M incluidas al mes). Con
la búsqueda sin optimizar, los totales eran unos 41 $ (típico, 20.000
usuarios), 62 $ (intenso, 5.000) y 370 $ (intenso, 20.000).

En todos los escenarios, el almacenamiento de D1 (2,1 GB de 5), R2, Workers
AI, las escrituras de D1 y las de KV quedan dentro de lo incluido.

**Cuándo se sale de los 5 $.** Lo primero que se agota es la CPU, y el
exceso al principio es de céntimos.

| Recurso | Con uso típico se agota hacia | Con uso intenso se agota hacia |
|---|---:|---:|
| CPU (30 M de ms) | 1.250 usuarios | 250 usuarios |
| Peticiones (10 M) | 8.300 usuarios | 1.650 usuarios |
| Filas leídas de D1 (25.000 M) | 37.000 usuarios | 7.400 usuarios |
| Lecturas de KV (10 M) | 16.600 usuarios | 3.300 usuarios |
| Eventos de log (20 M) | 13.900 usuarios | 2.800 usuarios |

**Qué abarataría los escenarios grandes:**

- **Búsqueda: ya hecho.** La optimización de la búsqueda y las sugerencias
  dejó una pantalla media en unas 2.250 filas (antes eran 7.000). En el caso
  de 20.000 usuarios con uso intenso, D1 pasa de 185 $ a 42,50 $.
- **Inicio de quien sigue a otras personas.** Ahora es lo que más filas lee
  (5.112 con 20 personas seguidas). Bajarlo a unos cientos dejaría D1 dentro
  de lo incluido incluso con 20.000 usuarios intensos.
- **Muestreo de logs.** Con `observability.head_sampling_rate` al 10 %, el
  coste de logs prácticamente desaparece.
- **CPU.** Medir la CPU real por petición antes de optimizar nada. Si es de
  10 ms y no de 20, la línea de CPU se reduce a la mitad.

---

## 3. Usuarios simultáneos

Workers crea isolates solos y no tiene límite de peticiones por segundo. Los
límites reales son estos:

1. **D1 es una sola base y ejecuta las consultas de una en una.** Según
   Cloudflare, con consultas de 1 ms caben unas 1.000 por segundo. Una
   pantalla caliente pasa en D1 entre 1 y 3 ms (ver «Motor D1» en el
   apartado 1).
   - **Búsqueda.** Ya no recorre unas 13.000 filas por petición, sino unas
     1.000. En producción, donde el tiempo de D1 va con las filas recorridas,
     debería ocupar D1 bastante menos que los ~50 ms de antes (una búsqueda
     más tres teclas). El arnés local, sin embargo, sigue midiendo 17 ms al
     buscar y unos 10 ms por tecla (`ola3\despues.json`), así que la
     estimación conservadora no cuenta todavía con esa mejora.
   - **Pantalla media.** Con la mezcla del apartado 2 ocupa D1 entre 3 y 7 ms
     de motor, y unos 10 ms en el peor caso si se suma la gestión de cada
     consulta.
   - **Cargas en frío.** Son mucho más caras: un perfil completo sin caché
     ocupa D1 entre 0,3 y 0,6 s. La colocación inteligente (`placement:
     smart`, activa desde el próximo despliegue) acerca el Worker a la base
     y acorta cada uno de esos viajes en serie. Eso reduce la espera del
     usuario; el tiempo de motor de D1 sigue siendo el mismo.
2. **Cargas en frío en días de competición.** Cualquier escritura en `sport_*`
   sube la versión de la caché del corpus deportivo. Los resultados
   automáticos escriben como mucho una vez por hora, así que en un día de
   campeonato cada hora hay una tanda de recargas. Las recargas se sirven en
   segundo plano y con la versión anterior delante. Aun así, ocupan D1: cada
   isolate recarga su copia hasta que la nueva está en KV.
3. **CPU por petición.** No es un cuello de botella: está topada en 30 s, que
   es el valor por defecto, y una página usa decenas de milisegundos.
4. **Límites por IP** de `wrangler.jsonc` → `ratelimits`. Se aplican por
   centro de datos de Cloudflare:
   - `LIMITE_PAGINAS` permite 1.200 peticiones por minuto e IP. Un usuario
     activo hace unas 10 por minuto, así que **unas 100-120 personas detrás de
     una misma IP** (wifi de un pabellón o CGNAT de un operador) pueden
     navegar a la vez antes de recibir errores 429.
   - `LIMITE_IP_SESION` (3.000 por minuto e IP) protege las rutas que cuentan
     por sesión.
   - `LIMITE_IMAGENES` permite 60 por minuto e IP, compartidas por todo el
     pabellón. Puede notarse en una lista con muchas fotos o carteles nuevos.
   - `LIMITE_SUGERENCIAS` (30 por minuto) y `LIMITE_ACCIONES` (120 por
     minuto) van por sesión y no limitan a los demás.

Para pasar de pantallas por segundo a personas, se supone que una persona
activa abre una pantalla cada 30 s de media.

| Estimación | Pantallas/s que aguanta D1 | Usuarios navegando a la vez | Supuesto |
|---|---:|---:|---|
| **Conservadora** | ≈ 35-40 | **≈ 1.000** | 10 ms de D1 por pantalla, con la mitad de la capacidad de D1 reservada para cargas en frío (día de competición) y tareas programadas. |
| **Optimista** | ≈ 170-300 | **≈ 5.000-9.000** | Caché caliente (cerca de 3 ms por pantalla), con la búsqueda ya optimizada ocupando D1 en proporción a sus ~1.000 filas, o con las réplicas de lectura de D1 activadas (gratis, `D1_SESIONES=replicas`, `docs/rendimiento.md` §6). |

En ambos casos el cuello de botella es la base de datos única, no el Worker.
Por encima de esas cifras D1 empieza a poner consultas en cola, y cuando la
cola se llena devuelve el error «overloaded». Para comparar con la escala del
proyecto: hay 63.322 personas deportivas en la base y 4 cuentas de usuario.

---

## 4. Peticiones diarias de las tareas programadas

Hay 10 expresiones en `triggers.crons`, que coinciden literalmente con
`TAREAS_CRON`. Cada disparo es una invocación del Worker. La tarea se ejecuta
dentro de esa misma invocación, sin otra petición HTTP, y escribe 2 filas en
`cron_execution` (reservar y cerrar).

| Hora UTC | Tarea | Qué hace | Peticiones externas al día (máx.) | Escrituras D1 al día (máx., estimadas) |
|---|---|---|---:|---|
| 03:00 | `ingest/skermo_rfee` | Calendario nacional, resultados de Skermo y enlaces de directo de Engarde | ≈ 50 (1 calendario + resultados y Engarde de los torneos en curso) | ≈ 600-1.000 filas (en octubre, ~200 eventos y ~411 pruebas; baja durante la temporada) |
| 03:30 | `ingest/fie` | Temporada FIE, torneos de −3 a +60 días e inscritos | ≈ 92 (≈44 fichas de torneo + ≈48 de inscritos) | ≈ 100-300 (sólo los torneos leídos ese día) |
| 04:00 | `ingest/efc` | Circuito EFC (el dominio responde 530) | 1 por semana | 1-2 |
| 04:30 | `ingest/skermo_regional` | 11 calendarios autonómicos | 11 | ≈ 260 en octubre (~85 eventos y ~172 pruebas) |
| 05:00 | `ingest/rfee_wp` | Circulares de esgrima.es | ≤ 9 | Normalmente 0-3. La media de `ingest_run` de 7 días marca 257 elementos actualizados: conviene revisarlo. |
| 05:30 | `ingest/skermo_ranking` | Ranking nacional, cuando le toca (tres días tras una prueba y una revisión semanal) | 0 la mayoría de días; ≈ 120 cuando toca (60 combinaciones + fichas) | Sólo filas cambiadas (media de 63 elementos) |
| 06:00 | `extraer` | Hasta 5 PDF nuevos con Workers AI | ≤ 5 descargas + ≤ 5 llamadas a la IA (~71 neuronas cada una) | ≤ ~400 (documentos y campos propuestos) |
| 06:45 | `ingest/fie_tiradores` | Fichas FIE de nuestros tiradores y clasificación mundial | ≈ 43 fichas + clasificación (48 el día que toca; ≈ 8,6 de media) | Sólo filas cambiadas (por hash; media de 23 elementos) |
| 07:00 | `notify` | Envío de avisos | 0 a fuentes externas (correo topado en 100 al día por `RESEND_DAILY_LIMIT`) | Una fila por aviso |
| :20 de 00-02 y 08-23 (19 pasadas) | `resultados` | Resultados automáticos: clasificación, poules y cuadro | ≤ 40 por pasada → **≤ 760** (un día sin pruebas nuevas: 1-25 por pasada) | ≤ 1.500 filas `sport_*` por pasada y **≤ 6.000 al día**; ≤ 48 MiB del libro al día; ≤ 6 unidades por pasada; IA ≤ 4 llamadas y ≤ 6.000 neuronas al día |

Totales:

| Concepto | Por día | Por mes (30 días) |
|---|---:|---:|
| Invocaciones del Worker por crons | 28 | ≈ 840 |
| Peticiones a fuentes externas, máximo | ≈ 1.150 | ≈ 34.500 |
| Peticiones a fuentes externas, día normal (sin pruebas nuevas ni ranking) | ≈ 420 | ≈ 12.600 |
| Filas `sport_*` de resultados automáticos, máximo | 6.000 | 180.000 |
| Filas D1 escritas en total (con índices, que cuentan aparte), máximo | ≈ 35.000 | ≈ 1 M (2 % de los 50 M incluidos) |
| Neuronas de Workers AI, máximo | ≈ 6.355 (6.000 de resultados + ~355 de circulares) | ≤ 10.000 al día gratis → 0 $ |
| Crecimiento máximo del libro de capacidad | 48 MiB | ≈ 1,4 GiB |

Estado real (consultado en `cron_execution`):

- Las 9 tareas diarias se han ejecutado 3 veces cada una en los últimos días,
  y todas terminaron bien salvo una de `skermo_rfee`.
- `resultados` lleva 5 pasadas, todas completas.
- `resultado_auto_consumo` está vacío, así que todavía no ha gastado IA ni ha
  escrito filas contabilizadas.

---

## 5. Almacenamiento

Consultado en producción el 7/10/2026, sólo con lecturas. El recuento de
tablas leyó 2,8 millones de filas, un 0,01 % de lo incluido en el mes.

| Recurso | Ocupado | Límite o cuota | % ocupado |
|---|---:|---:|---:|
| D1 `calendario-fie-fede-db` (`size_after`) | 2.101.309.440 B (2,10 GB) | 10 GB por base | **21,0 %** (y un 42 % de los 5 GB incluidos en el precio) |
| Libro de capacidad (`sport_capacity_ledger.accounted_bytes`) | 6.445.073.028 B (6,00 GiB) | 8 GiB (8.589.934.592 B, `D1_STORAGE_BUDGET_BYTES`) | **75,0 %** |
| R2 `calendario-esgrima-archivos` | 502 MB, 13.153 objetos | 10 GB gratis | **5,0 %** |
| KV `CACHE_DATOS` | 82 claves, todas con caducidad | 1 GB | Menos del 1 %, estimado (la lista de claves no da tamaños) |

Recuentos principales (sin datos personales):

| Tabla | Filas |
|---|---:|
| `sport_competition` (pruebas) | 13.230 |
| `sport_edition` (ediciones) | 10.987 |
| `sport_result` (puestos) | 684.017 |
| `sport_bout` (asaltos) | 1.559.030 |
| `sport_team_match` (encuentros por equipos) | 1.029 |
| `sport_person` (todas / raíces sin fusionar) | 70.817 / 63.322 |
| `perfil_deportista` | 63.322 |
| `sport_ranking_entry` | 318.070 |
| `event` / `event_competition` (calendario) | 496 / 805 |
| `user_profile` (cuentas de usuario) | 4 |
| `sport_favorite` / suscripciones push | 2 / 0 |

### Margen del libro de capacidad

El libro de capacidad es una cuenta propia y conservadora de lo escrito en
`sport_*`. Nunca baja, y cuenta unas tres veces más que el tamaño real (6,0
GiB anotados frente a 2,1 GB reales). Por eso el límite que se alcanzará
antes es el del libro, no el de D1. La ingesta automática deja de escribir
cuando el margen baja de 512 MiB, así que lo aprovechable es:

8.589.934.592 − 512 MiB − 6.445.073.028 = **1.607.990.652 B (≈ 1,50 GiB)**

| Ritmo de ingesta automática | Libro al mes | Meses de margen |
|---|---:|---:|
| Tope de bytes (48 MiB al día, todos los días) | ≈ 1,4 GiB | **≈ 1** (32 días) |
| Tope de filas (6.000 al día × ~2,4 KB, medido con el TNR de octubre: 1.400 filas ≈ 3,4 MB) | ≈ 0,41 GiB | **≈ 3,6** |
| Temporada normal (estimación: ~15.000 filas por semana entre FIE, EFC y nacional, ≈ 190 MiB al mes) | ≈ 0,19 GiB | **≈ 8** |

En D1 real, esos 1,5 GiB de libro equivalen a unos 0,5 GB. La base quedaría
en unos 2,6 GB cuando el libro se agote: dentro de los 5 GB incluidos y lejos
de los 10 GB. Antes de esa fecha habrá que decidir si se sube
`D1_STORAGE_BUDGET_BYTES` (el CHECK de `sport_write_context` admite hasta
8 GiB) o si se recalibra el libro con el tamaño real. Esto es una decisión
pendiente, no un fallo.

---

## 6. Cobertura de datos (resumen de `docs/cobertura-2026-10-07.md`)

Medida sobre `nuevo12`, copia exacta de producción tras el lote 11. Cuenta
las pruebas ya celebradas (hasta el 7/10/2026).

| Organismo | Pruebas | Con clasificación | Con poules (de las que aplican) | Con cuadro (de las que aplican) | Completas |
|---|---:|---:|---:|---:|---:|
| FIE desde 2014-15 | 4.402 | 99,1 % | 91,3 % | 90,9 % | **90,6 %** |
| FIE hasta 2013-14 | 4.779 | 91,5 % | 12,5 % | 18,3 % | **14,8 %** |
| EFC | 677 | 98,8 % | 85,6 % | 78,6 % | **78,6 %** |
| RFEE | 2.695 | 85,5 % | 79,4 % | 75,9 % | **72,2 %** |
| **Total** | **12.553** | **93,2 %** | **56,5 %** | **59,3 %** | **57,1 %** |

- **FIE anterior a 2014-15**: la FIE sólo publica la clasificación final, y
  no se ha encontrado otra fuente pública. Es el límite de la fuente.
- **EFC**: el lote 12 está preparado (Engarde y Fencing Worldwide). Añade 30
  cuadros y deja la EFC en un 83,0 % completa y el total en un 57,4 %.
- **RFEE**: de 750 huecos, 122 son de veteranos que se tiraron juntos con
  otro tramo de edad, y 64 son pruebas con un solo tirador. Corregir esos dos
  grupos llevaría la RFEE a cerca del 79 %.

---

## Qué no se ha podido medir

- **CPU real por petición en producción.** Se ha supuesto una media de 20 ms;
  el dato real está en Workers Observability.
- **Peticiones reales al Worker por pantalla.** Se han supuesto 4. Las
  precargas de Next.js dependen de cuántos enlaces hay a la vista.
- **Tamaño de KV.** El listado de claves no da tamaños, y no se han leído
  valores.
- **LCP.** La matriz sólo mide FCP y CLS, y lo hace en local.
- **Peticiones exactas de cada ingesta.** `ingest_run` guarda elementos vistos
  y escritos, no peticiones. Las cifras salen de `docs/tareas-programadas.md`
  y de los topes del código.
