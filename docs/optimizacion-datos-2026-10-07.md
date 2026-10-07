# Coste de datos: medición del 7 de octubre de 2026

## Resultado y límites

Dos cambios pequeños, sin índices, tablas, migraciones de producción ni caché de cuenta:

1. **Feed: 5.112 → 2.696 filas D1 por página, −47,3 %.** Los participantes de una misma prueba se cuentan una sola vez por sentencia, no por persona seguida. Sigue siendo una consulta y no usa KV. El filtro de medallas baja de 4.890 a 4.094 filas, −16,3 %.
2. **Caché compartida: una ráfaga fría de 50 peticiones pasa de 100 a 2 lecturas KV por clave**, manteniendo un único cálculo y dos escrituras. Cuando la definición prohíbe servir la versión anterior, se elimina además su escritura inútil: dos → una.

No hay evidencia de una gran mejora de latencia local. La reducción reproducible es de filas facturables y operaciones KV; no se promete soportar miles de usuarios con estas pruebas. Las mejoras de red, móvil y navegación corresponden al trabajo integrado del navegador.

Los conteos, cursores, orden y respuestas del feed son idénticos antes/después: huellas SHA-256 iguales, incluidos los 12.369 bytes JSON de la página y los 12.597 bytes con medallas. Son bytes de datos, **no HTML ni RSC completos**.

## Método

- Referencia funcional: HEAD inicial `172a1d8`; no se modificó Git ni producción.
- Espejo original, sólo leído para copiar: `C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\nuevo15.sqlite`.
- Espacio libre comprobado antes: 13,66 GB decimales, más de 6 GiB.
- Una única copia, instalada moviéndola en `C:\Users\alejandro.c.ramirez\AppData\Local\Temp\perf-opt-datos-20261007`. Eliminada al finalizar.
- `PERF_HOY=2026-10-07`; mismos datos, cuenta sintética de medición con 20 seguidas y filtros. No se guardan nombres, respuestas ni parámetros SQL en los informes.
- Esquema preparado en la copia: 0004 e índice construido, 0008, 0009, 0010 y 0012 que faltaban; aplicadas 0014/0015/0016/0017/0020. 0006 ya estaba; 0018 no era necesaria. Resultado: 84 tablas, 213 índices, 100 triggers y una vista. No se importaron historiales ausentes del espejo.
- D1 local real de workerd, `meta.rows_read`, mediante `tests/perf/d1-local.mts` y `medidor.mts`. Las consultas `raw()` se repiten fuera del cronómetro para obtener sus contadores; ese trabajo adicional del arnés no se atribuye a la ruta.
- Un proceso workerd a la vez. Cinco pasadas por escenario: la primera fría y cuatro calientes a concurrencia 1; cinco lotes calientes con concurrencia 10 y 50. Tres procesos independientes para las cargas frías del feed. No son 50 usuarios contra producción.
- Simulación KV: se ejecutan `crearCache`, `almacenKv`, `almacenMemoria` y `enCascada` reales sobre un transporte en memoria instrumentado, con espera artificial de 2 ms. Se cuentan `get`, `put` y bytes escritos; **no** se contacta KV remoto. El reloj local de Windows no garantiza esperas de exactamente 2 ms.

Artefactos agregados:
`C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\perf\opt-red-lenta\servidor`.

Los ficheros definitivos son `feed-final.json`, `feed-final-fria-{2,3}.json`, `feed-antes-concurrente.json`, `feed-fria-antes-{2,3}.json`, `medallas-final.json`, `medallas-antes-aislada.json` y `kv-{antes,despues}.json`. `antes.json` conserva la primera referencia de las cuatro rutas. **`despues.json`, `feed-conteos.json`, `medallas-aislada.json` y `feed-fria-despues-*` pertenecen a un experimento descartado**, no al código entregado.

## 1. Conteos del feed dentro de la misma sentencia

`src/lib/sport/explorar/seguidos.ts` materializa la página acotada y sus pruebas distintas. La CTE `conteos` ejecuta `count(*)` una vez por prueba y se une a los resultados de la página.

| Escenario, una petición | Consultas antes → después | Filas antes → después | Filas devueltas | JSON |
|---|---:|---:|---:|---:|
| Feed, proceso frío | 2 → 2 | 5.511 → 3.095 | 24 → 24 | 12.369 B |
| Feed, caliente | 1 → 1 | 5.112 → 2.696 | 21 → 21 | 12.369 B |
| Medallas, proceso frío aislado | 2 → 2 | 5.289 → 4.493 | 24 → 24 | 12.597 B |
| Medallas, caliente | 1 → 1 | 4.890 → 4.094 | 21 → 21 | 12.597 B |

La fría añade 399 filas del detector de esquema; no se confunden con el feed. Cero escrituras D1 y cero lecturas/escrituras KV en todos estos escenarios.

Tiempos locales del feed:

| Concurrencia/estado | p50 antes → después | p95 antes → después | Filas por lote antes → después |
|---|---:|---:|---:|
| 1, fría, tres procesos | 174 → 178 ms | 176 → 193 ms | 5.511 → 3.095 |
| 1, caliente, cuatro muestras | 66,7 → 77,0 ms | 90,2 → 92,8 ms | 5.112 → 2.696 |
| 10, caliente | 782 → 773 ms | 792 → 783 ms | 51.120 → 26.960 |
| 50, caliente | 3.886 → 3.892 ms | 3.931 → 3.945 ms | 255.600 → 134.800 |

En concurrencia 10/50 se muestra la mediana de los p50/p95 de cinco lotes, no un percentil combinado inventado. En concurrencia 1 se calculan los percentiles de las muestras individuales. Con tres o cuatro muestras, p95 es prácticamente el máximo, no una estimación poblacional sólida.

La reducción de filas no se convierte automáticamente en menor TTFB: pesan las idas al proxy local, su serialización y el planificador del proceso. No se presenta el pequeño movimiento de milisegundos como una ganancia demostrada.

### Semántica

- Favoritos, cuenta, sesión y resultados se siguen leyendo en cada petición.
- Misma ventana, fallback sin ventana, límite máximo de 300 seguidas, deduplicación de fusiones, cursor y filtros.
- `count(*)` sigue incluyendo todos los resultados de la prueba, también los participantes sin identidad o sin puesto; no cuenta sólo las personas seguidas.
- La reutilización termina con la sentencia: no hay obsolescencia nueva, época que consultar, nueva ida a D1 ni N solicitudes KV.
- Sólo se materializan como máximo las filas de la página y sus pruebas distintas. No se añade coste de mantenimiento de índices.

Con esta distribución de pruebas, un millón de páginas ahorraría aproximadamente **2.416 millones de lecturas de filas**, antes de cuotas y precios. Es una extrapolación de coste por página, no una promesa de tráfico o dinero: con pocas pruebas compartidas el ahorro será menor.

## 2. Lecturas KV concurrentes y alias innecesario

`src/lib/cache/cache.ts` ya deduplicaba los cálculos, pero cada petición hacía sus propias lecturas de la entrada y del alias antes de llegar al cálculo compartido. Ahora comparte únicamente la promesa de lectura en vuelo por clave y la retira tanto al terminar como al fallar. No retiene nuevos valores, no cambia TTL, versiones, privacidad ni reglas de revalidación.

Además, con `anteriorMientrasRevalida: false`, no se escribe un alias que nunca se leerá.

| Ráfaga fría | Lecturas KV antes → después | Escrituras antes → después | Bytes escritos antes → después |
|---|---:|---:|---:|
| 1, con versión anterior | 2 → 2 | 2 → 2 | 384.016 → 384.016 |
| 10, con versión anterior | 20 → 2 | 2 → 2 | 384.016 → 384.016 |
| 50, con versión anterior | 100 → 2 | 2 → 2 | 384.016 → 384.016 |
| 1, sin versión anterior | 1 → 1 | 2 → 1 | 384.016 → 192.006 |
| 10, sin versión anterior | 10 → 1 | 2 → 1 | 384.016 → 192.006 |
| 50, sin versión anterior | 50 → 1 | 2 → 1 | 384.016 → 192.006 |

Payload sintético de 191.881 caracteres más envoltorio, cinco repeticiones independientes de cada caso; un cálculo por ráfaga antes y después. En caliente todos los casos tienen cero cálculos y cero operaciones KV, al encontrarse la entrada en memoria.

Mediana de p50/p95 locales de las cinco ráfagas frías:

| Concurrencia | Con anterior, antes → después | Sin anterior, antes → después |
|---|---|---|
| 1 | 45,6/45,6 → 46,0/46,0 ms | 30,9/30,9 → 30,0/30,0 ms |
| 10 | 45,8/45,9 → 45,8/45,8 ms | 28,9/28,9 → 29,2/29,2 ms |
| 50 | 35,6/35,6 → 36,7/36,7 ms | 29,0/29,0 → 29,1/29,1 ms |

No hay una ganancia de velocidad demostrada en este transporte simulado; sí una reducción de operaciones ejecutadas. La deduplicación sólo actúa dentro del mismo isolate y durante el solapamiento, no entre todos los centros de datos. No elimina la latencia ni la consistencia eventual propias de KV.

## Cabecera y cálculo olímpico: lo observado, no una mejora ficticia

La cabecera fría sigue siendo cara. Con el detector de esquema ya caliente: **38 consultas, 54.000 filas, 191.881 B JSON, 2 lecturas y 2 escrituras KV**; la fría completamente aislada añade una consulta/399 filas. La referencia dio 3.995 ms y la pasada posterior 3.176 ms; dos procesos adicionales dieron 3.260 y 3.290 ms. El SQL no cambió: **no se atribuye esa variación de tiempo al parche**.

En caliente, la cabecera pública hizo cero consultas D1 y cero KV; las cuatro muestras de referencia dieron p50/p95 de 6,2/6,6 ms antes de serializar la respuesta del arnés. El contexto de prueba no tiene atletas propios: no se está midiendo ni eliminando el trabajo real de sesión, propiedad o favoritos. A 50 peticiones la deserialización y la serialización de unos 9,6 MB agregados ya consumen aproximadamente medio segundo local.

Los principales bloques de lectura fría identificados fueron el balance de asaltos (13.579 filas), estadísticas por prueba (10.976) y detección de temporadas olímpicas (11.657). No se reescribieron agresivamente sin prueba de equivalencia.

El cálculo olímpico individual ya tenía memoria por prueba durante diez minutos y una promesa compartida: **3 consultas/14.674 filas en frío; 0 consultas/0 filas en caliente**, incluso a concurrencia 10/50. Sus 133.056 B son el objeto interno completo medido, no los bytes que necesariamente recibe el móvil. Añadir ahora KV por persona o duplicar esa caché no estaba justificado por estas mediciones.

### Experimentos descartados

- Limitar por persona las fechas candidatas mediante `json_each` conservaba resultados, pero elevaba la consulta sin participantes de 1.206 a 3.155 filas. Se retiró.
- Una caché LRU de participantes por prueba, versionada y sin KV, conseguía 1.206 filas calientes. Sin embargo, necesitaba época y consulta de faltantes: **cuatro consultas y 286–348 ms en frío**, frente a dos consultas y unos 174 ms. Se retiraron el módulo y sus pruebas; no forma parte de la entrega. Se eligió la materialización SQL porque mantiene una sola ida y la consistencia inmediata.

## Reproducción

PowerShell 7, ejecutables locales, sin instalar paquetes:

```powershell
$r = 'C:\Users\alejandro.c.ramirez\Documents\calendarioFedeEsgrima'
$node = 'C:\Program Files\nodejs\node.exe'
$tsx = "$r\node_modules\tsx\dist\cli.mjs"
$h = "$r\tests\perf\opt-datos.mts"
$out = "$env:USERPROFILE\calendario-datos\calendario-trabajo\perf\opt-red-lenta\servidor"
Set-Location $r
Get-PSDrive C | Select-Object Free # exigir más de 6 GiB
$env:PERF_ESTADO = "$env:TEMP\perf-opt-datos-20261007"
$env:PERF_COPIA = "$env:PERF_ESTADO\trabajo.sqlite"
$env:PERF_ORIGEN = 'C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\nuevo15.sqlite'
$env:PERF_HOY = '2026-10-07'
New-Item -ItemType Directory -Force $out | Out-Null
& $node $tsx $h --preparar # sólo con estado nuevo y copia inexistente
$env:PERF_FILTRO = 'feed'
$env:PERF_CONCURRENCIA = '1,10,50'
$env:PERF_REPETICIONES = '5'
& $node $tsx $h "$out\feed-antes-concurrente.json" --feed-anterior
& $node $tsx $h "$out\feed-final.json"
# Frías independientes: procesos distintos, mismo estado, sin recopiar.
$env:PERF_CONCURRENCIA = '1'
$env:PERF_REPETICIONES = '1'
foreach ($i in 2,3) {
  & $node $tsx $h "$out\feed-fria-antes-$i.json" --feed-anterior
  & $node $tsx $h "$out\feed-final-fria-$i.json"
}
$env:PERF_REPETICIONES = '5'
$env:PERF_FILTRO = 'feed-medallas'
& $node $tsx $h "$out\medallas-antes-aislada.json" --feed-anterior
& $node $tsx $h "$out\medallas-final.json"
# Elegir cabecera u olimpica para procesos fríos independientes.
$env:PERF_FILTRO = 'cabecera'
& $node $tsx $h "$out\cabecera.json"
$env:PERF_FILTRO = 'olimpica'
& $node $tsx $h "$out\olimpica.json"
& $node $tsx $h "$out\kv-antes.json" --cache --anterior
& $node $tsx $h "$out\kv-despues.json" --cache
```

`--feed-anterior` reconstruye en memoria las tres diferencias SQL del algoritmo original y usa el mismo mapeo de resultados; exige un feed no vacío. `--cache --anterior` repone en memoria las lecturas independientes y la escritura del alias originales. Ninguna opción reescribe fuentes ni ejecuta Git. Las métricas coinciden con la referencia tomada antes de los cambios. Para comparar frías auténticas, no mezclar las rutas en un proceso: el modo sin filtro se conserva como diagnóstico, pero comparte detectores y memoria entre rutas.

## Validación y seguridad

```powershell
& $node "$r\node_modules\vitest\vitest.mjs" run `
  tests/perf-opt-datos.test.ts tests/explorar-social.test.ts `
  tests/cache-compartida.test.ts tests/cache-refuerzo.test.ts `
  tests/perfil-cache.test.ts tests/cache-local.test.ts `
  tests/perfil-edad-menores.test.ts tests/olimpica-temporadas.test.ts `
  --maxWorkers=1 --minWorkers=1
& $node "$r\node_modules\typescript\bin\tsc" --noEmit --incremental false
```

**135 tests aprobados en ocho ficheros; TypeScript sin errores.** Las siete pruebas nuevas cubren equivalencia de conteos y planes de materialización, participantes sin identidad, filtro de medallas, límites de página y lecturas/escrituras KV con 1/10/50 peticiones. Los tests existentes cubren cursores, fusiones, aislamiento entre cuentas, menores y caché de perfil. No hubo fallos ajenos que justificar.

No cambian autorización, revocación, sesión, propiedad de ficha, veto de menores, TTL o límites. No se cachea una lista de favoritos ni una respuesta de cuenta. No se añadieron esqueletos, paquetes ni índices. No se tocó `capturas/`, producción ni el espejo original.

Pendiente de integración por el agente principal: build conjunto, navegador/red lenta y, tras autorización, despliegue y observación real. La cabecera fría y los cálculos olímpicos al arrancar un isolate siguen siendo candidatos, no problemas declarados resueltos por este parche.
