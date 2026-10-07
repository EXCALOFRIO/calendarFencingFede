# Informe final (7 de octubre de 2026)

Resumen de cómo queda la aplicación tras el trabajo de esta jornada. El
detalle de cada parte está en los documentos enlazados al final.

## 1. Qué hay en producción

Versión del Worker `4017c1be-848b-488e-9c09-71a3cfebc662` (desplegada a las
18:22 UTC). Base D1 `calendario-fie-fede-db`.

| Dato | Antes de todo este trabajo | Ahora |
|---|---:|---:|
| Pruebas | 5.256 | **13.226** |
| Resultados (puestos) | 248.694 | **683.765** |
| Asaltos | 668.128 | **1.560.727** |
| Personas (con perfil) | 13.299 | **63.313** |
| Rankings: fuentes / listas / filas | — | **21 / 2.848 / 337.167** |
| Torneos en el calendario | — | 496 |

## 2. Cobertura de las pruebas ya celebradas

«Completa» = clasificación más poules y cuadro cuando la prueba los tiene.

| Organismo | Pruebas | Con clasificación | Con poules | Con cuadro | Completas |
|---|---:|---:|---:|---:|---:|
| FIE desde 2014-15 | 4.402 | 99,1 % | 91,3 % | 90,9 % | **90,6 %** |
| FIE hasta 2013-14 | 4.779 | 91,5 % | 12,5 % | 18,3 % | 14,8 % |
| EFC | 677 | 98,8 % | 85,6 % | 83,0 % | **83,0 %** |
| RFEE | 2.694 | 85,4 % | 79,4 % | 75,9 % | **72,2 %** |
| **Total** | 12.552 | **93,2 %** | 56,4 % | 59,5 % | **57,4 %** |

Lo que falta y por qué (detalle en `docs/cobertura-2026-10-07.md`):

- **FIE hasta 2013-14**: la FIE sólo publica la clasificación; no existen poules
  ni cuadros públicos de esos años (límite de la fuente).
- **RFEE**: 199 pruebas con PDF sin esas fases legibles, 176 sin documento
  publicado ni archivado, 127 en las que la fuente sólo publica una parte y 64
  de un solo tirador (no puede haber poule).
- **EFC**: 74 PDF de FencingTime sin marcadores legibles y 19 de equipos sin
  lector.

## 3. Rankings por federación

| Organismo | Temporadas | Listas | Filas vinculadas | % de lo publicado vinculado |
|---|---|---:|---:|---:|
| FIE (actual + histórico) | 2003–2027 | 439 | 177.677 | 27 % / ≈100 % |
| EFC (europeo) | 2009-10–2026-27 | 137 | 44.617 | 67 % |
| RFEE (España) | 2012-13–2026-27, sin 2016-17 | 411 | 31.686 | 73 % |
| Italia | 2017-18–2026-27 | 210 | 24.306 | 27 % |
| Estados Unidos | 2009-10–2026-27 | 269 | 15.338 | 54 % |
| Hungría | 2013-14–2026-27 | 264 | 12.281 | 68 % |
| Gran Bretaña | 2019-20–2026-27 | 180 | 8.468 | 30 % |
| Francia | 2022-23–2026-27 | 97 | 7.464 | 21 % |
| Austria | 2006-07–2025-26, con huecos | 288 | 4.458 | ≈50 % |
| República Checa | 2021-22–2026-27 | 144 | 2.976 | 40 % |
| Singapur | 2019-20–2025-26 | 126 | 2.635 | 41 % |
| Canadá | 2021-22–2025-26 | 120 | 2.562 | 18 % |
| Turquía, Bulgaria, Hong Kong, Rumanía, Australia, Portugal, Venezuela | 1 temporada | 134 | 2.491 | 3-51 % |
| Países Bajos | 2 temporadas | 29 | 208 | 28 % |

- El 89 % de los 53.349 tiradores con resultados internacionales tiene al
  menos un ranking.
- Sin ranking nacional, por motivo: Alemania, Suiza, Suecia, Grecia, Bélgica y
  otros publican en Ophardt, que prohíbe el acceso automático; Polonia tiene
  un control anti-bots; Japón, Corea, China, Taipéi y Egipto sólo publican en
  su alfabeto; Ucrania usa vistas previas de Google Drive; Israel está detrás
  de Cloudflare; México, India, Kazajistán e Irán no publican ranking; Rusia
  y Bielorrusia compiten como neutrales.
- Se actualizan solos el ranking FIE (cada día) y el de la RFEE; el resto se
  carga por lote.

Detalle: `docs/rankings-estado-2026-10-07.md`.

## 4. Rendimiento antes y después

Filas leídas de D1 por pantalla con la caché llena («antes» = sin caché).

| Pantalla | Antes | Ahora |
|---|---:|---:|
| Armazón de cada página (sesión y menú) | 1.011 | 6 |
| Calendario, mes actual | 9.137 | 6 |
| Ficha de un torneo | 15.494 | 6 |
| Perfil completo (Llavador) | 172.742 | 74 |
| Edición de un Mundial | 51.969 | 0 |
| Cara a cara | 4.770 | 0 |
| Ranking del seleccionador | 35.378 | 8 |
| Buscar competiciones, por tecla | 23.260 | 0 |
| Buscar tiradores («zabala») | 873 (índice antiguo) | 946 |
| Ficha de un país (nueva) | — | 1 |

Además: un perfil sin caché pasa de 14 a 6 esperas seguidas a la base, y el
Worker se coloca junto a D1 (`placement: smart`) para que esas esperas sean
más cortas.

## 5. Costes y usuarios

Plan Workers Paid (5 $/mes con mucho incluido). Estimación con 5 pantallas
por visita; «típico» = 2 visitas al día, «intenso» = 10.

| Usuarios activos al mes | Uso típico | Uso intenso |
|---:|---:|---:|
| 100 | 5 $ | 5 $ |
| 1.000 | 5 $ | 6,80 $ |
| 5.000 | 6,80 $ | ≈ 35 $ |
| 20.000 | ≈ 24 $ | ≈ 227 $ |

- **Usuarios a la vez**: unos 1.000 en la estimación conservadora y entre
  5.000 y 9.000 en la optimista. El límite es la base de datos única.
- **Desde una misma wifi** (por ejemplo, un pabellón): unas 100-120 personas a
  la vez antes de que el límite por IP empiece a frenar.
- Lo primero que se sale de lo incluido es la CPU del Worker, por céntimos.

Detalle: `docs/capacidad-costes-2026-10-07.md`.

## 6. Tareas programadas y peticiones diarias

| Concepto | Cada día | Al mes |
|---|---:|---:|
| Ejecuciones programadas del Worker | 28 | ≈ 840 |
| Peticiones a fuentes externas (máximo) | ≈ 1.150 | ≈ 34.500 |
| Peticiones a fuentes externas (día normal) | ≈ 420 | ≈ 12.600 |
| Filas que puede escribir la ingesta automática | ≤ 6.000 | — |
| IA (neuronas; gratis hasta 10.000 al día) | ≤ 6.355 | — |

La ingesta automática de resultados corre cada hora (fuera de 03:00-07:59
UTC), lee FIE, Skermo, Engarde y los PDF de la RFEE, y sólo usa IA para los
PDF que el lector no lee entero, con validación estricta. Ya no reescribe
nada cuando no hay cambios (antes, unas 1.600 escrituras inútiles al día).

## 7. Almacenamiento

| Recurso | Usado | Límite | % |
|---|---:|---:|---:|
| Base D1 | 2,21 GB | 10 GB | **22 %** |
| R2 (archivos) | 502 MB | 10 GB gratis | 5 % |
| KV (caché) | 216 claves | 1 GB | < 1 % |
| Libro de capacidad propio | 2,55 GB | 8 GiB | 30 % |

- El libro de capacidad (contador de seguridad que nunca baja) estaba en el
  75 % porque contaba unas 3 veces más que el tamaño real. Se recalibró al
  tamaño real con margen. La ingesta se para sola si se acercara al tope.
- La auditoría no encontró restos antiguos que borrar: las 83 tablas están en
  uso. Se quitaron dos índices duplicados (≈ 101 MB) y se añadió una limpieza
  diaria de registros antiguos.

## 8. Lo que se ha hecho

**Datos (lotes 11 a 13, todos en producción y verificados):**

- Poules y cuadros de PDF releídos con el lector mejorado (89 + 74 fases).
- Uniones de personas con evidencia (licencia, continuidad en la prueba, club y
  año) y 4 uniones revisadas a mano; se deshizo una unión equivocada (dos
  «Martín López Ruiz»).
- Géneros corregidos en 5 pruebas cargadas al revés y en sus fichas (por
  ejemplo, Carlos Llavador tenía una ficha «femenina» duplicada).
- Años de nacimiento falsos de la FIE (1920) borrados.
- Pruebas repetidas fundidas, veteranos de tramos conjuntos enlazados y
  semifinales mal rotuladas corregidas.
- 30 cuadros de la EFC y rankings de 11 países más.

**Aplicación:**

- Países: ficha de cada país y cara a cara entre selecciones (individual y
  equipos, con relevos).
- Buscador de competiciones tolerante a erratas, filtros según lo que se
  busca y pestaña Países.
- Todo enlazado: del calendario a los resultados, de los resultados a cada
  tirador, su país y su cara a cara; los avisos abren su destino exacto.
- Navegación como Instagram: tocar la pestaña activa vuelve a su inicio (se
  acabó el bucle de la brújula).
- Perfil más rápido y gráfica de puestos por tramos con frases que la
  explican.
- Inscritos enlazados con foto, bandera y puestos FIE/RFEE; tu foto en «Tú».
- «Hoja de poule», «Tablón de N», nombres compactos iguales en toda la app,
  sin rebote al hacer scroll y animaciones cortas.
- Accesibilidad WCAG 2.2 AA y tercera revisión de seguridad aplicadas.

## 9. Pendiente y recomendaciones

1. **Dominio propio.** Hoy la app vive en `excalofrio.workers.dev`, compartido
   con otros 16 Workers de la cuenta. Recomendado para seguridad de las
   cookies: pasos en `docs/guia-administracion.md` § 7.
2. **Inscritos de Skermo**: no traen licencia ni ID, así que no se pueden
   enlazar a perfiles sin adivinar por el nombre.
3. **Revisión humana**: 29 grupos de veteranos, 840 clasificaciones con huecos
   y otros casos listados en `calendario-trabajo\lote12-informes\calidad.md` y
   `lote13-informes\lote13.md`.
4. **Política de seguridad del contenido (CSP)**: sigue en modo informe;
   pasarla a obligatoria cuando el informe esté limpio.
5. **Git**: hay dos commits locales nuevos (`413fe6d` y `37e8b7b`) sin subir.

## 10. Documentos

- `docs/indexado-2026-10-05.md`: lotes, marcadores de Time Travel y capacidad.
- `docs/cobertura-2026-10-07.md`, `docs/rankings-estado-2026-10-07.md`,
  `docs/capacidad-costes-2026-10-07.md`, `docs/limpieza-produccion-2026-10-07.md`.
- `docs/guia-usuario.md`, `docs/guia-administracion.md`, `docs/integraciones.md`,
  `docs/diseno-sistema.md`, `docs/rendimiento.md`.
