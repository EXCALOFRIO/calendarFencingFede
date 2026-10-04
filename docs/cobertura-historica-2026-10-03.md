# Cobertura histórica: cantidades, porcentajes y acceso

Medición del 03/10/2026 sobre la copia histórica local verificada. Los porcentajes
tienen denominadores distintos y explícitos. No existe un inventario exhaustivo
que permita afirmar un porcentaje de todo el histórico mundial o nacional.

## Pruebas y hechos aceptados

| Fuente | Pruebas catalogadas localmente | Con resultados aceptados | Porcentaje | Resultados | Asaltos |
|---|---:|---:|---:|---:|---:|
| FIE | 3.153 de 9.216 conocidas | 2.736 | 29,69 % de las conocidas; 86,77 % de las catalogadas | 205.476 | 662.963 |
| RFEE / Skermo HTML | 942 | 942 | 100 % de las 942 recuperadas | 31.151 | 0 |
| RFEE PDF | 1.161 | 508 | 43,76 % de las pruebas reconocidas en PDF | 12.067 | 5.165 |
| Total local | 5.256 | 4.186 | 79,64 % de lo catalogado localmente | 248.694 | 668.128 |

Son registros de prueba por fuente, no un censo deduplicado de torneos reales.
Un torneo puede tener varias armas, categorías y pruebas; HTML y PDF pueden
describir la misma competición. «Con resultados» no significa «completa».

La copia tiene también 4.407 ediciones, 13.299 personas y 19.312 registros de
cobertura. Frente al snapshot base: 3.671 pruebas, 198.212 resultados y 635.173
asaltos adicionales. Los 31.151 puestos HTML ya estaban; repetirlos no los
convierte en resultados nuevos.

## Completitud y pendientes

- **FIE:** 6.063 de 9.216 clasificaciones conocidas siguen pendientes (65,79 %).
  Hay 1.074 completas, 11 parciales, 417 sin resultados y 1.651 en conflicto.
  De esos conflictos, 1.650 son vínculos de identidad aplazados y uno es una
  respuesta vacía después de resultados previamente aceptados. No significan
  1.651 clasificaciones descartadas. Los hechos previos se conservan.
- **FIE, asaltos:** 1.737 pruebas contienen asaltos. La cobertura de poules tiene
  394 parciales, 1.320 pendientes y 298 sin resultados; la de tableau tiene
  1.381 completas, 356 parciales y 275 sin resultados. Estos denominadores son
  2.012 pruebas con seguimiento de fase, no las 9.216 clasificaciones conocidas.
- **Skermo HTML:** 939 de 942 clasificaciones completas (99,68 %) y tres en
  conflicto. Una necesita identidad confirmada y dos revisión de fuente.
- **PDF:** 468 de 1.161 clasificaciones completas (40,31 %), 587 parciales,
  105 sin resultados y una en conflicto. Solo 99 pruebas contienen asaltos.
  En el nivel documental hay 13 completos de 1.411 (0,92 %), 836 parciales,
  553 pendientes, dos conflictos, un error y seis sin resultados.
  La clasificación puede estar completa aunque poules o tableau no lo estén.
  La nueva relectura usa sesiones Factory y lectura nativa de PDF, sin OCR.
  Sus candidatos siguen separados de estos hechos aceptados.
- **Ranking de tiradores FIE:** 145 unidades de cobertura, 107 completas,
  24 pendientes y 14 sin resultados. No son otras 145 competiciones.

No se convierten los estados «pendiente», «parcial», «conflicto» o
«sin resultados» en un falso «completo» para mejorar el porcentaje.

## Descargas y archivo de originales

| Inventario acotado | Total | Resultado |
|---|---:|---|
| Segunda vuelta FIE | 3.154 unidades | 3.137 cerradas, 11 parciales, seis errores; todas evaluadas |
| RFEE HTML | 942 documentos | 942 válidos, 100 % |
| RFEE PDF | 1.411 documentos | 1.408 válidos, tres respuestas malformadas, 99,79 % |
| RFEE total | 2.353 documentos | 2.350 válidos, 99,87 % |

«Descarga cerrada» no acredita que una identidad esté confirmada o que todas
las fases deportivas estén completas. La caché FIE contiene 3.166 entradas,
pero el inventario aprobado y evaluado tiene 3.154 unidades: no se mezclan ambos
denominadores ni las entradas auxiliares.

R2 privado conserva 9.614 blobs FIE, tres particiones y un índice verificados,
además de 2.109 blobs nacionales y su manifiesto. Son objetos deduplicados por
contenido, no cantidades de competiciones ni de documentos con resultados.
El prefijo histórico interno no se publica por la ruta normal de archivos.

## Identidades y comprobaciones técnicas

| Fuente | Resultados vinculados a persona | Porcentaje |
|---|---:|---:|
| FIE | 75.808 / 205.476 | 36,89 % |
| RFEE / Skermo HTML | 31.123 / 31.151 | 99,91 % |
| RFEE PDF | 0 / 12.067 | 0 % |

En FIE, 150.317 de 662.963 asaltos tienen ambos participantes vinculados
(22,67 %); en PDF ninguno de los 5.165 tiene ambos vínculos. Los resultados
pueden existir por competición aunque no aparezcan en la ficha de una persona
ni en un cara a cara. No se fusionan homónimos por nombre.

Comprobaciones de la copia histórica: cero errores de relaciones, cero hechos
sin URL/hash de procedencia y `quick_check=ok`. Esto acredita integridad técnica,
no exactitud deportiva independiente de cada fila.

Las funciones reales de lectura de ediciones y clasificación también pasaron
contra esa copia: dos páginas de 20 puestos en cada fuente (FIE, PDF, HTML),
sin repetir filas; 30 consultas de solo lectura. Sin sesión se denegó antes de
consultar. Se usó un perfil sintético de test, no una sesión Neon real ni una
concesión QA en producción. No se registraron nombres o filas privadas.

## Catálogo y nueva extracción Factory (04/10/2026)

El catálogo local de `/explorar/ediciones` ya incluye todas las fuentes, con
búsqueda por nombre/ciudad, fuente, temporada y paginación de 25 ediciones.
Conserva la búsqueda al abrir una edición, su clasificación y una ficha.
La lectura sobre la copia histórica inmutable verificó:

| Fuente | Ediciones | Pruebas |
|---|---:|---:|
| FIE | 2.770 | 3.153 |
| RFEE / Skermo HTML | 942 | 942 |
| RFEE PDF | 695 | 1.161 |
| Total | 4.407 | 5.256 |

Dos páginas por fuente y dos del total, 16 consultas de solo lectura, sin
duplicados y sin cambiar el hash del SQLite. Sin sesión se denegó antes de
consultar. Las 91 pruebas focalizadas de catálogo/edición/URL/acceso anónimo
pasaron; TypeScript completo pasó tras corregir el entorno del hijo Factory.
Son lecturas locales con perfil sintético, no acceso Neon autenticado.

El DOM sintético se midió en el panel del navegador a 320, 393, 768 y 1440 px
CSS efectivos: sin desborde y con etiquetas y controles táctiles. La auditoría
automática no encontró infracciones, pero dejó incompleto el contraste sobre
el degradado. Las capturas del panel repetían regiones aunque el DOM tenía
un solo catálogo; no se presentan como prueba visual completa.
El intento de Tab en el panel no avanzó el foco; el diagnóstico local del
navegador pasó, pero no acredita navegación por teclado. Queda para QA real.

Los pilotos reales de `droid exec --model gpt-6-sol` produjeron 26 filas de
cuadro PDF (13 cruces) y 14 filas FIE (3 clasificación, 6 poule, 5 cuadro).
No se suman a la tabla de hechos aceptados. Las 26 citas PDF coinciden con el
texto nativo; de las 28 citas FIE, 26 coinciden y dos añadían un campo ausente
del JSON original, por lo que siguen en revisión. Citas correctas no prueban
por sí solas interpretación deportiva, identidad ni exhaustividad.

El propietario autorizó todo el inventario, en lotes acotados: hasta 1.408 PDF
y 3.154 unidades FIE con sesiones independientes, salida JSON y controles de
lectura. La preparación y ejecución de ese lote no modifica el manifiesto
congelado, D1, Neon ni las cantidades aceptadas anteriores.
[`Extracción Factory`](./extraccion-factory.md).

## Publicación y acceso real

Código confirmado y subido a `main`: `97458b6`. Originales privados archivados.
El corte independiente `64805183` mantiene producción en 503. La exportación
final congelada y su composición pasaron; las 1.045.210 filas de 54 tablas se
importaron y verificaron dos veces localmente, código 0.

D1 tiene el esquema base `0000`. La carga remota está en curso; no se ha
publicado todavía el runtime D1 ni se cuenta ninguna prueba como accesible en
la web. `/entrar`, `/explorar` y `/explorar/ediciones` se comprobaron en 503.
La verificación remota y el acceso con OTP/roles deben acreditarse por separado.
Neon y la versión anterior se conservan para recuperación.

Lectura remota a las 00:04:41 UTC del 04/10: marcador `importing`,
`insert:sport_bout:44400`, 5.256 competiciones, 248.694 resultados y 44.400
asaltos; cero escrituras de la comprobación. Es un avance parcial, no el
resultado de la verificación final ni una cantidad disponible en la web.
