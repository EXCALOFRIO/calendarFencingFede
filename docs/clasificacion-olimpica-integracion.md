# Integración: marca olímpica en el ranking internacional (FIE)

La clasificación olímpica de LA 2028 **no es un ranking aparte**: es una marca
en cada fila del ranking internacional y un filtro «Solo JJOO». Reglas en
`docs/clasificacion-olimpica-la2028.md`.

Terminología: el ranking de la FIE es «Internacional», nunca «Mundial».

## Piezas

| Pieza | Fichero | Tipo |
|---|---|---|
| `getAnotacionesOlimpicas(arma, genero)` | `src/lib/queries/olimpica.ts` | servidor, `cache` |
| `anotarRankingOlimpico(entrada, { cercanos? })` | `src/lib/ranking/olimpica/anotar.ts` | puro |
| `ordenarSoloJjoo(filas, datos)` | `src/lib/ranking/olimpica/anotar.ts` | puro |
| `BurbujaOlimpica` | `src/components/olimpica/burbuja-olimpica.tsx` | cliente |
| `InsigniaOlimpica` | `src/components/olimpica/insignia-olimpica.tsx` | sin estado |
| `FiltroOlimpico` | `src/components/olimpica/filtro-olimpico.tsx` | cliente |

`PruebaOlimpica` y `ClasificacionOlimpica` (vista por prueba) **quedan sin usar**
en esta integración; se conservan por si la burbuja necesita un «ver todo».

### Datos

```ts
getAnotacionesOlimpicas(arma: 'FLORETE' | 'ESPADA' | 'SABLE', genero: 'M' | 'F')
  : Promise<AnotacionesPrueba | null>

type AnotacionesPrueba = {
  arma; genero;
  fechaRanking: string | null;          // ISO, lectura más vieja de los dos grupos
  equipos: Record<string, AnotacionOlimpica>;    // clave: FilaFie.pais («ESP»)
  individual: Record<string, AnotacionOlimpica>; // clave: String(FilaFie.fieId)
};
```

Solo tiene sentido con `category === 'ABS'` y `gender` `M`/`F`. Para cualquier
otro grupo no se pide y no se pinta nada. Las filas sin marca no están en el
diccionario.

`AnotacionOlimpica.estado`: `'clasificado'` (verde), `'cerca'` (amarillo),
`'pendiente'` (gris: RUS, BLR y neutrales `FIE`) o `null` (sin pastilla; puede
llevar `camino: 'TORNEO_ZONAL'`).

### Componentes

```tsx
<BurbujaOlimpica anotacion={AnotacionOlimpica | null | undefined} fechaRanking={string | null} />
<FiltroOlimpico activo={boolean} onCambio={(v: boolean) => void} cuantos?={number} />
```

`BurbujaOlimpica` no pinta nada si `anotacion?.estado` es `null`, así que se
puede poner en todas las filas sin condiciones.

## Dónde va cada cosa

### 1. Cargar las marcas junto a la tabla

Donde hoy se resuelve `primeraTabla` (la página de ranking, en el servidor) y
en la acción `cargar` que trae cada grupo, añadir las marcas del grupo:

```ts
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';

const olimpica =
  grupo.category === 'ABS' && grupo.gender !== 'MIXTO'
    ? await getAnotacionesOlimpicas(grupo.weapon, grupo.gender)
    : null;
```

Lo más simple es añadir `olimpica: AnotacionesPrueba | null` a
`TablaClasificacionFie` (o devolverlo al lado) para que viaje con la tabla y no
haga un segundo viaje. Pesa poco: unas decenas de marcas por grupo más las de
«torneo zonal».

### 2. `tabla-fie.tsx`: la pastilla después del nombre

En `Fila`, justo después del nombre (individual: `fila.nombre`; selecciones:
`fila.paisNombre`), dentro del mismo contenedor `min-w-0`:

```tsx
const anotacion = porEquipos
  ? olimpica?.equipos[fila.pais ?? '']
  : olimpica?.individual[String(fila.fieId)];

<span className="min-w-0 break-words">{fila.nombre ?? `FIE ${fila.fieId}`}</span>
<BurbujaOlimpica anotacion={anotacion} fechaRanking={olimpica?.fechaRanking ?? null} className="ml-1.5" />
```

El contenedor del nombre tiene que ser `inline-flex items-center` (o `flex`)
para que la pastilla no salte de línea sola a 320 px.

### 3. `selectores-grupo.tsx`: el conmutador

Junto al interruptor «Solo España» (hoy vive en `tabla-fie.tsx`; si el
rediseño lo pasa a `SelectoresGrupo`, va ahí al lado). Mostrarlo **solo si**
hay marcas (`olimpica !== null`):

```tsx
{olimpica ? (
  <FiltroOlimpico activo={soloJjoo} onCambio={cambiarJjoo} cuantos={cuantosJjoo} />
) : null}
```

Si va en `SelectoresGrupo`, añadirle dos props opcionales:
`soloJjoo?: boolean` y `onSoloJjoo?: (v: boolean) => void` (y `cuantosJjoo?`).

### 4. Orden y filtro con el conmutador encendido

En el `useMemo` de `filtradas` de `tabla-fie.tsx`, después de «Solo España» y
del buscador:

```ts
import { ordenarSoloJjoo } from '@/lib/ranking/olimpica';

if (soloJjoo && olimpica) {
  f = ordenarSoloJjoo(f, (r) => ({
    anotacion: porEquipos ? olimpica.equipos[r.pais ?? ''] : olimpica.individual[String(r.fieId)],
    posicion: r.position,
  }));
}
```

Resultado: primero los verdes por puesto, luego los amarillos de más a menos
probable (menos puntos que faltan; a igualdad, mejor puesto) y al final los
grises que entrarían o estarían cerca si contaran. El resto no sale.
`cuantosJjoo` es la longitud de ese resultado sin el buscador.

Con el filtro encendido no se recorta con «Ver más» (igual que con «Solo
España»): `const recorta = !busqueda && !soloEspana && !soloJjoo;`.

### 5. URL

Parámetro `?jjoo=1`. Leerlo al montar (`useSearchParams`) para el estado
inicial y escribirlo con `router.replace` (sin `scroll`) al cambiar. Si el grupo
elegido no es olímpico (no ABS, o mixto), ignorarlo y no pintar el conmutador.

## Fecha del ranking

`fechaRanking` sale de `fie_clasificacion_lectura` (migración
`drizzle-d1/0009_fie_clasificacion_lectura.sql`), y es la lectura más vieja de
los dos grupos de la prueba. Sin la migración aplicada, se usa el último
`updated_at` de las filas. La burbuja la enseña con la pastilla «Provisional».
