# Costes y escalado (8 de octubre de 2026)

Reproducible con `node scripts/estimar-costes.mjs` (escenarios habituales),
`--dau 500 --sesiones 4 --acciones 8` (uno concreto) o `--perfil antes` (la
versión `485b5ac`). Los consumos por acción salen de las mediciones de esta
ronda (`docs/mejoras-2026-10-08.md`) y de `docs/capacidad-costes-2026-10-07.md`.

## Resumen

- **Tenerla activa sin usuarios cuesta 5 US$/mes**, la cuota del plan Workers
  Paid. La ingesta automática usa menos del 1 % de lo incluido.
- **Con 500 usuarios al día** (4 sesiones de 8 acciones) sigue en **5 US$/mes
  en Cloudflare**, con margen: las filas leídas de D1 bajan un 91 % respecto a
  la versión anterior. El recurso más cerca de su límite es la CPU, que es una
  estimación (20 ms por petición dinámica; hay que confirmarla en el panel).
- Lo que puede costar dinero antes que Cloudflare son los servicios externos:
  el cómputo de Neon que valida las sesiones y Resend si se mandan avisos por
  correo a todos.

## Precios usados (publicados en octubre de 2026)

| Servicio | Incluido en el plan | Precio del exceso |
|---|---|---|
| Workers Paid (cuota) | — | 5 US$/mes |
| Peticiones dinámicas | 10 M/mes (los estáticos son gratis) | 0,30 US$ por millón |
| CPU | 30 M ms/mes | 0,02 US$ por millón de ms |
| D1 filas leídas | 25.000 M/mes | 0,001 US$ por millón |
| D1 filas escritas | 50 M/mes | 1,00 US$ por millón |
| D1 almacenamiento | 5 GB | 0,75 US$/GB-mes |
| KV lecturas / escrituras | 10 M / 1 M al mes | 0,50 / 5,00 US$ por millón |
| R2 | 10 GB, 1 M escrituras, 10 M lecturas | 0,015 US$/GB-mes; 4,50 / 0,36 US$ por millón |
| Workers AI | 10.000 neuronas/día | 0,011 US$ por 1.000 neuronas |
| Workers Logs | 20 M eventos/mes | 0,60 US$ por millón |
| Resend (avisos por correo) | 100/día y 3.000/mes gratis | Pro: 20 US$/mes, 50.000 correos |
| Neon (autenticación) | Free: 100 CU-hora/mes | Launch: ~0,11 US$/CU-hora |

## Medido en producción

- D1: 2,49 GB tras el índice de selecciones (antes 2,21 GB) de 5 GB
  incluidos. R2: 502 MB en 13.292 objetos de 10 GB.
- Las 24 h del 7 de octubre registraron 11,1 M de filas escritas y 182 M
  leídas, pero fueron la carga del lote 13, la recalibración del libro y la
  verificación del espejo; las consultas del Worker sólo escribieron 15.469.
- Un día normal de ingesta: la cadena nocturna leía ~165.000 filas y escribía
  ~14.400; con esta versión, ~4.900 escrituras menos por noche.
- Cada reconstrucción completa del índice de países escribe ~3,3 M filas
  (≈ 7 % de lo incluido al mes). Se hace a mano tras cargar un lote, no a diario.

## Escenarios (esta versión)

Supuestos: 30 días, 8 acciones por sesión, 20 ms de CPU por petición
dinámica, campana cada 5 minutos, precargas sólo con 4G.

| Escenario | Peticiones/mes | CPU/mes | Filas D1 leídas | Filas D1 escritas | KV lect./escr. | Coste Cloudflare/mes |
|---|---:|---:|---:|---:|---:|---:|
| Sólo ingesta, sin usuarios | 840 | 1,3 M ms | 6 M | 150 k | 0 / 3 k | 5,00 US$ |
| 100 usuarios/día × 4 sesiones | 222,84 k | 5,74 M ms | 113,24 M | 195 k | 48 k / 103 k | 5,00 US$ |
| 500 usuarios/día × 2 sesiones | 555,84 k | 12,4 M ms | 274,11 M | 375 k | 120 k / 103 k | 5,00 US$ |
| **500 usuarios/día × 4 sesiones** | **1,11 M** | **23,5 M ms** | **542,22 M** | **375 k** | **240 k / 103 k** | **5,00 US$** |
| 500 usuarios/día × 8 sesiones | 2,22 M | 45,7 M ms | 1,08 mil M | 375 k | 480 k / 103 k | 5,31 US$ |
| 2.000 usuarios/día × 4 sesiones | 4,44 M | 90,1 M ms | 2,15 mil M | 1,05 M | 960 k / 103 k | 6,20 US$ |
| 5.000 usuarios/día × 4 sesiones | 11,1 M | 223,3 M ms | 5,37 mil M | 2,4 M | 2,4 M / 103 k | 10,52 US$ |

Con la versión anterior, los 500 usuarios × 4 sesiones leían ~6.140 M filas
al mes (búsqueda de fotos sin índice: 43.161 filas por llamada) y 5.000
usuarios al día habrían costado ~47 US$/mes; ahora ~10,50 US$.

## Ocupación con 500 usuarios/día × 4 sesiones

| Recurso | Uso/mes | Incluido | Ocupación |
|---|---:|---:|---:|
| Peticiones dinámicas | 1,11 M | 10 M | 11 % |
| CPU (estimada) | 23,5 M ms | 30 M ms | 78 % |
| D1 filas leídas | 542 M | 25.000 M | 2,2 % |
| D1 filas escritas | 375 k | 50 M | 0,8 % |
| D1 almacenamiento | 2,49 GB | 5 GB | 50 % |
| KV lecturas / escrituras | 240 k / 103 k | 10 M / 1 M | 2,4 % / 10 % |
| R2 | 0,5 GB, 240 k lecturas | 10 GB, 10 M | 5 % / 2,4 % |
| Workers AI | 300 neuronas/día | 10.000/día | 3 % |
| Eventos de registro | 2,2 M | 20 M | 11 % |

## Servicios externos

- **Neon (sesiones).** Antes, cada petición validaba la sesión en Neon
  (~38.000 comprobaciones al día con 500 usuarios); ahora, sin cookie no se
  llama y con sesión se reutiliza 30 s: ~5.500 al día. Aun así, con usuarios
  repartidos durante el día, el cómputo de Neon puede quedarse despierto unas
  16 h diarias: ~120 CU-hora al mes, por encima de las 100 gratuitas. Vigilarlo
  en su panel; en el plan Launch serían unos 13 US$/mes en el peor caso.
- **Correos del código.** Los envía Neon Auth, no Resend: 25–150 al día con
  500 usuarios, según cuánto dure la sesión.
- **Avisos por correo (Resend).** La aplicación limita a 100 al día, igual
  que el plan gratuito: un correo a cada uno de 500 usuarios tarda 5 días.
  Para un correo diario a todos haría falta Pro (20 US$/mes). Las
  notificaciones push no cuestan nada.
- **Dominio propio** (~10–15 €/año): permite activar la caché compartida de
  Cloudflare, gratuita, que absorbe lecturas frías.

## Cuánto cuesta por usuario

| Configuración con 500 usuarios/día | Coste/mes | Por usuario activo |
|---|---:|---:|
| Sólo Cloudflare (lo actual) | 5 US$ | 0,01 US$ |
| + Neon Launch si se pasan las 100 CU-hora | ~18 US$ | 0,04 US$ |
| + Resend Pro para avisos diarios por correo | ~38 US$ | 0,08 US$ |
| + dominio propio | ~39 US$ | 0,08 US$ |

Lo que se cobre por encima de eso es margen para soporte y mantenimiento.
