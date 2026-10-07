# Optimización para móviles y conexiones lentas

## Punto de partida

Revisión nueva, posterior al despliegue `4017c1be` y al commit `172a1d8`.
Se comprobó que esa versión atendía el 100 % del tráfico y que `/entrar`
respondía con HTTP 200. No se hicieron escrituras ni pruebas de carga sobre
producción.

Objetivo: menos consultas, peticiones y bytes, y una respuesta más fluida al
buscar, navegar y volver a una pantalla. Sin esqueletos, sin rebajar la
protección de menores ni guardar datos de cuenta en cachés públicas.

## Cómo se compara

Se separan dos medidas que no significan lo mismo:

1. **Coste de datos:** consultas, filas leídas y operaciones de caché en D1
   local (workerd), con datos y filtros iguales. Las medidas de consultas
   simultáneas se ejecutan sólo en la máquina local.
2. **Experiencia del navegador:** aplicación compilada con OpenNext, ejecutada
   en un Worker local. Chromium a 360 × 780, CPU limitada y dos conexiones
   simuladas:

   | Perfil | CPU | Descarga | Subida | Latencia añadida |
   |---|---:|---:|---:|---:|
   | Móvil modesto | 4 veces más lenta | 1,6 Mbit/s | 750 kbit/s | 150 ms |
   | Cobertura pobre y ahorro de datos | 6 veces más lenta | 400 kbit/s | 200 kbit/s | 400 ms |

El arnés `tests/perf/red-lenta-local.mts` crea una sola copia de trabajo y una
cuenta de QA sintética de sólo lectura. Las claves existen sólo en memoria.
El navegador no usa sesiones reales, bloquea otros orígenes y no guarda HAR,
HTML ni información personal en los resultados.

Las operaciones son: abrir Buscar competiciones, buscar «mndial», abrir una
competición, abrir un perfil, pasar a Estadísticas, recargar y volver atrás.
Cada repetición empieza con un navegador nuevo, pero la caché del Worker
puede estar caliente. Las recargas conservan la caché de ese navegador.
No se llama «caché fría» a todas esas muestras.

Se mide hasta que la ruta y su contenido principal están presentes y se han
pintado dos frames. Peticiones y bytes se observan además durante una ventana
fija de 1,2 segundos. FCP/LCP pertenecen a cargas de documento, no al tiempo de
una navegación interna. Los informes de los componentes aíslan precargas,
fotos, escritura rápida y movimiento con respuestas deterministas.
La navegación usa `tap`, no un click de ratón que pueda precargar al pasar
el puntero. Las banderas, fuentes e iconos se clasifican como archivos
estáticos cuando están en los assets del paquete, no como llamadas al Worker.
Las solicitudes a rutas dinámicas tampoco equivalen automáticamente a
ejecuciones facturadas: una respuesta puede venir de la caché del navegador.

### Repetición

Desde la raíz del repositorio, con una compilación ya hecha:

```powershell
$env:PERF_ORIGINAL = 'C:\ruta\espejo.sqlite'
$env:PERF_MOVIL_DIR = 'C:\ruta\medicion-local'
# Opcional: conservar el paquete anterior para repetirlo sin tocar Git.
$env:PERF_PAQUETE = 'C:\ruta\paquete-anterior'
node node_modules/tsx/dist/cli.mjs tests/perf/red-lenta-local.mts antes normal 3
node node_modules/tsx/dist/cli.mjs tests/perf/red-lenta-local.mts antes limitada 3
# Con el Worker anterior ya detenido, compilar los cambios y repetir:
Remove-Item Env:PERF_PAQUETE
node node_modules/tsx/dist/cli.mjs tests/perf/red-lenta-local.mts despues normal 3
node node_modules/tsx/dist/cli.mjs tests/perf/red-lenta-local.mts despues limitada 3
```

La carpeta contiene una copia local regenerable y resultados agregados. El
espejo original no se modifica. El arnés no acepta un servidor remoto como
destino y no arranca tareas programadas.

## Límites

- La sesión sintética no mide el viaje a Neon Auth. No equivale a un inicio
  de sesión real ni a una sesión de producción.
- El espejo contiene el corpus deportivo de producción, pero no todos los
  históricos auxiliares. Se aplican las migraciones necesarias en la copia;
  antes y después usan la misma copia y los mismos datos.
- No reproduce el coste de arranque de Cloudflare, todos los teléfonos, los
  cortes de radio reales ni la caché mundial de KV.
- Varias repeticiones sirven para comparar, no para prometer un SLA.
  Reducir filas leídas no implica por sí solo reducir el tiempo en la misma
  proporción.
- La capacidad de miles de usuarios simultáneos necesita una prueba de carga
  en un entorno de ensayo y telemetría real. No se deduce de una consulta local
  rápida. Los costes calculados son escenarios, no una factura medida.

## Informes por área

- `docs/optimizacion-datos-2026-10-07.md`: consultas y caché del servidor.
- `docs/optimizacion-cliente-2026-10-07.md`: peticiones, red lenta y movimiento.
- Resultados integrados: `calendario-trabajo/perf/opt-red-lenta/navegador`,
  ficheros `{antes,despues}-{normal,limitada}.json`.

## Comparación integrada de la optimización

Medianas de tres repeticiones, en segundos. Se incluyen también los casos
sin mejora; no se escogió sólo la muestra más rápida.

| Operación | Móvil modesto, antes → después | Cobertura pobre, antes → después |
|---|---:|---:|
| Abrir Buscar competiciones | 1,623 → 1,703 | 5,624 → 5,417 |
| Buscar «mndial» | 0,686 → 0,809 | 1,537 → 1,602 |
| Abrir una competición | 2,261 → 2,042 | 4,910 → 3,959 |
| Abrir el perfil | 1,205 → 1,050 | 2,948 → 3,068 |
| Pasar a Estadísticas | 1,272 → 1,156 | 2,569 → 1,554 |
| Recargar el perfil | 1,100 → 1,078 | 2,504 → 2,216 |
| Volver atrás | 0,063 → 0,049 | 0,122 → 0,062 |

En cobertura pobre, las solicitudes a rutas dinámicas observadas al abrir
una competición pasan de 5 a 1 y al abrir Estadísticas de 5 a 1. La recarga
baja de 4 a 3. Parte de las solicitudes anteriores eran trabajo de fondo del
armazón; no se atribuyen todas al contenido de la ruta. La cuenta sintética
de QA añade enlaces propios que no tiene una cuenta normal.

El ahorro de consultas y operaciones es reproducible. Las diferencias de
tiempo son mediciones de laboratorio con variación del sistema y pocas
muestras: **no prueban que todas las páginas sean más rápidas**. En especial,
buscar «mndial» no mejora y la primera apertura del perfil con mala cobertura
queda prácticamente igual. No se promete una carga instantánea ni capacidad
para un número concreto de usuarios en producción.

### Repetición con el nuevo acceso y la instalación PWA incluidos

Tras integrar ambas peticiones adicionales se repitió el recorrido completo
con cobertura pobre (400 kbit/s, 400 ms y CPU 6×), tres veces:

| Operación | Antes | Versión lista para publicar |
|---|---:|---:|
| Abrir Buscar competiciones | 5,624 s | 5,616 s |
| Buscar «mndial» | 1,537 s | 1,388 s |
| Abrir una competición | 4,910 s | 3,796 s |
| Abrir el perfil | 2,948 s | 3,089 s |
| Pasar a Estadísticas | 2,569 s | 2,538 s |
| Recargar el perfil | 2,504 s | 2,445 s |
| Volver atrás | 0,122 s | 0,126 s |

La variación entre tandas confirma que no procede atribuir una gran mejora de
latencia a todas las pantallas. Las reducciones de filas, lecturas KV y
peticiones innecesarias sí están comprobadas. La repetición final quedó sin
errores y conservó barra fija, ausencia de desbordes y vuelta a la raíz.
Artefacto: `publicacion-final-limitada.json`.

## Mejoras comprobadas por separado

| Cambio | Antes | Después | Qué demuestra |
|---|---:|---:|---|
| Feed con 20 personas seguidas | 5.112 filas D1/página | 2.696 | −47,3 % de lecturas, misma respuesta y una sola consulta |
| Ráfaga fría de 50 solicitudes, misma clave e isolate | 100 lecturas KV | 2 | Se comparten las lecturas simultáneas, no sólo el cálculo |
| Alias de caché que no admite versión anterior | 2 escrituras KV | 1 | No se guarda una copia que nadie va a leer |
| Scroll de la muestra de fotos | 9 solicitudes, 54 personas | 1 solicitud, 6 personas | Se consultan los retratos visibles |
| Buscar y pulsar Intro | 2 solicitudes | 1 | Se cancela el debounce antes del envío explícito |
| CSS total del paquete | 186.760 B | 175.394 B | Sólo se generan utilidades usadas en `src` |
| CSS total comprimido con gzip | 31.864 B | 30.098 B | −1.766 B, una mejora pequeña |

Las cifras del cliente son de un arnés sintético controlado; la tabla
integrada usa la aplicación compilada. No se mezclan ambas como si fueran
tiempos de producción. El CSS, en particular, no explica por sí solo un
cambio grande de velocidad.

### Campana de avisos: trabajo de fondo que se elimina

El rastreo de la aplicación compilada encontró una petición a
`/api/notificaciones` tras cada cambio de ruta. Duplicaba una lectura que
el servidor ya había hecho al pintar la campana.

Ahora se reutiliza ese contador y se consulta como máximo cada minuto
mientras la pestaña está visible y hay conexión. Volver de segundo plano
consulta sólo si la lectura está caducada; un push o recuperar conexión
pueden forzarla. Marcar leído sigue revalidando el layout y actualiza la
lectura inicial, incluso si vuelve a cero.

El estado vive sólo en memoria del navegador, separado por cuenta. Se aborta
una petición al desmontar la última campana o cambiar de cuenta. Una respuesta
antigua no puede sobrescribir el contador de otra cuenta ni una lectura SSR
más reciente. No se cambió la autorización del endpoint ni se usó una caché
compartida para este dato.

Doce pruebas cubren dos campanas, 20 intentos de refresco en una ventana corta, petición concurrente,
cambio de cuenta, revalidación mientras hay una petición, respuestas inválidas
y recuperación de errores. El retraso máximo ordinario del punto de la campana
sigue siendo un minuto; no se presenta como tiempo real.

## Cómo afecta al coste

- El suelo del plan no cambia: hacer menos consultas no rebaja por sí solo la
  tarifa fija de 5 dólares.
- Con la distribución medida, un millón de páginas del feed evita unos
  2.416 millones de lecturas de filas. El ahorro en dinero depende de haber
  agotado o no las lecturas incluidas.
- Reducir KV de 100 a 2 sólo se aplica a solicitudes que coinciden en el
  mismo isolate y clave. No es un −98 % de toda la factura de KV.
- La campana deja de generar una nueva solicitud por cada pantalla visitada,
  lo que evita también su validación de sesión y lectura del contador.
- No se añadieron servicios, almacenamiento precalculado, índices ni trabajos
  programados. Los perfiles fríos y la autenticación siguen necesitando
  medición de producción antes de prometer una mejora grande de latencia.

## Validación

- TypeScript correcto y compilación de producción con OpenNext correcta.
- Pasaron las pruebas de los subagentes: 135 de datos/caché y 88 del cliente.
- En la integración se ejecutaron 106 pruebas de navegación, enlaces y acceso
  anónimo; 113 de CSS, feed y caché; 109 de notificaciones, aislamiento y barra;
  y 19 de fotos, sugerencias y CSS. Hay solapamientos, no se suman como casos
  únicos.
- El navegador comprueba además que el documento no desborde, la barra siga
  fija al hacer scroll y tocar la pestaña activa no añada una entrada al
  historial para volver a la raíz. Las doce repeticiones finales (antes y
  después, dos conexiones) terminaron sin errores de JavaScript y con esas
  tres comprobaciones correctas.
- El paquete final no contiene archivos `.env` ni valores de configuración
  incrustados en `cloudflare/next-env.mjs`.
- No se repitieron las más de 5.000 pruebas de todo el repositorio. Se
  ejecutaron las suites de los caminos modificados, el tipado y la compilación.

## Publicación y limpieza

El usuario autorizó desplegar y subir los commits a GitHub después de validar.
Las pruebas de carga y navegador se mantuvieron locales: no se hicieron
contra producción.

Desplegado el código del commit `2c295b5` en la versión de Cloudflare
`8c3e8aee-c0e8-4171-88f0-3be8b3ed396c`. Comprobado con un navegador aislado:
acceso público visible, rutas privadas con redirección, APIs sin sesión con
401, manifest standalone con cuatro iconos y `sw.js` con `no-cache`.

La integración final de acceso y PWA pasó 115 pruebas, TypeScript y build.
Los arneses hidratados comprobaron diez escenarios de instalación y 24
capturas del formulario (pegado, autofill simulado, ceros, edición, errores,
pendiente y movimiento reducido). No se usaron códigos ni cuentas reales
en esos arneses. Queda pendiente la prueba física del teclado/autofill y de
la instalación en Safari/iPhone y Chrome/Android.

Se retiraron 5.840 capturas e informes generados (2,51 GiB), conservando 180
informes pequeños fuera del repositorio. Los resultados nuevos de QA se
excluyen de Git. Se mantiene `capturas/capturar.mjs`, enlazado desde npm.
Sólo se retiraron dos scripts temporales sin referencias: `_consulta.ts`
(vacío) y `_dias.ts`. Los lotes históricos y las migraciones se conservan
porque sirven para pruebas y reconstrucción, no son basura por ser antiguos.
