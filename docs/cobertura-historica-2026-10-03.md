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
  OCR y revisión manual siguen pendientes.
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
