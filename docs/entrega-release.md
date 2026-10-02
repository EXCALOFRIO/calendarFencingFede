# Entrega: registro de la publicación y guía del propietario

Fecha: 02/10/2026. Este documento dice qué se publicó, qué se comprobó y qué
**no** se comprobó. La revisión privada (con cuenta real) es del propietario y
queda **pendiente**.

## Qué se publicó

| Dato | Valor |
|---|---|
| Worker | `calendario-fie-fede` (solo ese) |
| Cuenta | `52d39cf14bc17b94754729436036124d` |
| Origen | https://calendario-fie-fede.excalofrio.workers.dev |
| Versión nueva (100 %) | `3fb282b6-2800-433a-b7da-d8be528ed193` (18:16 UTC) |
| Versión anterior | `39b7900c-2a6c-4b82-87e2-ca6bc482a67e` (29/09/2026) |
| Código | HEAD `6b969ba` más cambios solo de comentario y documentación (ninguno de configuración) |
| Compilación | `npm run cf:build` con `NEXT_PUBLIC_APP_URL` fijada al origen publicado y **sin** `CF_ENV_EMBEBIDO` |
| Publicación | `opennextjs-cloudflare deploy --env-file NUL` (publica `.open-next` ya comprobado, no recompila) con el inicio de sesión OAuth de Wrangler |

Se conservaron los bindings (`ARCHIVOS` en R2, `IMAGES`, `AI`, `ASSETS`), las
variables de `wrangler.jsonc` y los **nueve crons** (la salida del despliegue los
lista: 03:00, 03:30, 04:00, 04:30, 05:00, 05:30, 06:00, 06:45 y 07:00 UTC). Los
nueve nombres de secretos siguen en el almacén (`AWS_ACCESS_KEY_ID`,
`AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_SECRET_ACCESS_KEY`,
`CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET`, `DATABASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_URL`); no se leyó ni subió ningún valor. No se
tocaron otros Workers, cuotas, planes, dominios, cuentas de Neon Auth ni
compras. No se hizo `git push`.

## Comprobaciones antes de publicar

Se ejecutaron una detrás de otra:

| Comprobación | Resultado |
|---|---|
| Vitest seguro del manifiesto (`--maxWorkers=3`, sin `datos`, `enlaces` ni `seguridad`) | **Primera pasada: falló 1 test** (`tests/skermo.test.ts`, «idempotencia del parseo»: tiempo agotado a 60 s en una pasada de 220 s con 1787 aprobados). El fichero solo, con un trabajador, **pasó** (29 tests, el test lento tardó 39 s). **Segunda pasada completa: 1788 aprobados, 7 omitidos, 109 ficheros aprobados y 2 omitidos.** El fallo era de tiempo y no se reprodujo; no se ha demostrado su causa. |
| `npm run typecheck -- --incremental false` | Aprobado |
| `git diff --check` | Aprobado |
| `npm run cf:build` | Aprobado. No se ejecutó además `npm run build` por separado: `cf:build` ya lo contiene. |
| Espacio libre en C: | 6,59 GiB al empezar, 7,07 GiB antes del build y 6,95 GiB después (umbral 5 GiB; no se liberó nada). Una lectura anterior de 4,61 GiB estaba por debajo y se repitió antes de compilar. |
| Secretos en el paquete | Se buscaron 14 valores sensibles de `.env` (incluidas la contraseña y el usuario de `DATABASE_URL`) en los 2157 ficheros de `.open-next`: **0 coincidencias y 0 ficheros `.env`**. `next-env.mjs` quedó vacío. El resultado del `wrangler deploy --dry-run` (3 ficheros) tampoco tuvo coincidencias. Solo se imprimieron nombres y recuentos. Los valores no secretos `AI_PROVIDER` y `AI_MODEL` se excluyeron del escaneo porque aparecen en el código y en `wrangler.jsonc`. |
| Revisión final independiente (antes de publicar) | `VERDICT: PROCEED`, sin defectos bloqueantes en guardas, privacidad, estado de migraciones, últimos arreglos, secretos del paquete y destino/bindings/crons. Dos notas no bloqueantes se resolvieron: el comentario de `wrangler.jsonc` ahora dice 9 crons y se documentó que `/api/archivos/*` es una excepción abierta. |

`npm run lint` no sirve en Next 16 y no se ejecutó.

## Comprobaciones después de publicar (solo lectura, sin sesión)

Hechas con peticiones HTTP `GET` de lectura. **No se invocó ningún cron ni
endpoint de ingesta.**

- `/entrar`: 200, título «Entrar · CalendarFencing», formulario de correo
  presente, sin referencias a `localhost`.
- Sin sesión, `307` a `/entrar` en `/`, `/estado`, `/ranking`, `/perfil`,
  `/convocatorias`, `/documentos`, `/tiradores`, `/alta`, `/admin`, `/explorar`,
  `/explorar/ediciones`, `/explorar/ediciones/<id>`, `/explorar/favoritos`,
  `/explorar/<personaId>` y `/explorar/<personaId>/cara-a-cara` (con UUID
  inexistentes: la guarda actúa antes de leer).
- Con la cabecera `RSC: 1` Next añade `?_rsc` y, tras seguir esa redirección,
  responde con una carga de redirección (`NEXT_REDIRECT`) sin datos deportivos
  (se buscaron `sport_`, `nombre` y `apellido`, sin coincidencias). Las pruebas
  se hicieron con `/explorar`, `/explorar/favoritos`, `/ranking` y una ficha.
- Feed iCal con tokens inexistentes: `404`. Un `GET` de ruta inexistente: `404`.
- Recursos: dos `/_next/static/chunks/*.js` responden `200` con
  `text/javascript`, y `/manifest.webmanifest` responde `200`. `/favicon.ico`,
  `/manifest.json` y `/icon-192.png` dan `404` (no se asume que existan).
- `agent-browser` **no funcionó** en esta sesión: los comandos de apertura
  quedaron colgados hasta el tiempo límite y la sesión se cerró. Por eso no hay
  captura ni comprobación de navegador; solo HTTP.

**No comprobado por el agente:** inicio de sesión real, cualquier página con
datos, roles, arma propia o ajena, favoritos, cara a cara con datos, correos,
rendimiento (Core Web Vitals) y los cuatro anchos.

## Qué hacer después: QA privada manual

La hace el propietario con su cuenta, **sin** cuentas temporales ni cookies
copiadas:

1. [`matriz-qa-manual-responsive.md`](matriz-qa-manual-responsive.md): atleta,
   seleccionador de su arma, seleccionador de otra arma y admin, a 320, 393, 768 y
   1440 px, con teclado, zoom y movimiento reducido.
2. [`favoritos-guia-manual.md`](favoritos-guia-manual.md).
3. Comprobar que el origen publicado figura en Neon Auth (Domains) y que el
   código de acceso llega por correo. Si el inicio de sesión responde
   `403 INVALID_ORIGIN`, falta añadirlo ahí.

## Cómo volver atrás

Revierte **solo el código**:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '52d39cf14bc17b94754729436036124d'
node node_modules/wrangler/bin/wrangler.js rollback 39b7900c-2a6c-4b82-87e2-ca6bc482a67e --name calendario-fie-fede --env-file NUL
```

Neon **no** se revierte: las tablas `sport_*`, los enums, los datos y el ledger
(19 filas) se quedan. No hay SQL de bajada autorizado ni copia o punto de
restauración de Neon acreditados. Con la versión anterior en producción, las
pantallas nuevas de Explorar dejan de existir, pero sus tablas siguen en la base.

## Estado de los datos y límites de la evidencia

- Migraciones 0017 → 0018 → 0019 aplicadas en una transacción (ledger 16 → 19, 13
  tablas deportivas, categorías M10/M12). No se reaplican ni se hizo más ingesta
  en esta entrega. El preflight del comando devuelve 2 por estar ya aplicadas.
- **El corpus histórico no está completo.** Solo hay el piloto acotado descrito
  en el `README.md`. La primera relectura FIE elegible reescribirá una lista por
  la 0018, acotada, sin lote ilimitado.
- Contabilidad del piloto: 21 peticiones HTTP conocidas **más** una invocación
  mal entrecomillada cuyo número de peticiones es desconocido. No es un total
  exhaustivo y no demuestra el cumplimiento de 40 peticiones/300 s para todo el
  conjunto.
- Los conteos de tablas antiguas fueron iguales antes y después del piloto, pero
  eso **no prueba igualdad de valores**. `notification` tiene 3 filas frente a 0
  en la auditoría previa, sin atribución. **No se investigó ni limpió nada**, y
  las consecuencias históricas del incidente de pruebas del 02/10/2026 ni se
  han demostrado ni se descartan.
- Tamaños: base completa 29,35 → 30,17 MiB y `public` 18,64 → 19,46 MiB tras el
  piloto; son métricas lógicas y no el consumo facturado. El plan de Neon sigue
  sin verificar.
- Piloto de IA (hasta 10 PDF y 1 €, aprobado por el usuario): **no se envió
  ningún PDF** ni hay gasto. Siguen sin verificar la vía de inferencia, el coste
  y la cuota de la cuenta, el modelo y la privacidad de listados nominales; no se
  gastó nada nuevo.
- La proyección de «Mi estado» (9.600 → 400 filas) es **sintética**, con datos
  inventados; no hay Core Web Vitals reales.
- `/api/archivos/*` sirve PDF y snapshots de R2 sin sesión (diseño heredado,
  documentado en el código). Es una excepción a «todo exige sesión» y queda como
  mejora pendiente de decisión.
