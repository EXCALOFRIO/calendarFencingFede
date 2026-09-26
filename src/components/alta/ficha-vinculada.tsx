import { Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ResumenFicha } from '@/app/(app)/alta/consultas';
import { Cuenta, Rotulos, Seccion } from '@/components/estado/piezas';
import { puntos } from '@/components/ranking/formato';
import { Button } from '@/components/ui/button';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, formatDateEs } from '@/lib/utils';

/**
 * La prueba de que el alta ha funcionado.
 *
 * Petición literal del usuario: *«todo eso debería salir por ahí para que se
 * sepa que está bien»*. Un «listo» verde no demuestra nada; lo que demuestra
 * que la ficha es la correcta es ver el puesto y los puntos oficiales, porque
 * son datos que la persona reconoce y que no ha tecleado nadie.
 *
 * Por eso el puesto va en cifra de marcador y no en una frase: es lo primero
 * que se mira y es la confirmación.
 */
export function FichaVinculada({
  resumen,
  reciente,
  varias,
}: {
  resumen: ResumenFicha;
  /** Acaba de vincularse, frente a haber vuelto a mirar la pantalla. */
  reciente: boolean;
  /** La cuenta gestiona más de un tirador (un tutor con dos hijos). */
  varias: boolean;
}) {
  const mejor = resumen.clasificaciones[0] ?? null;
  const categoria = mejor
    ? (CATEGORY_LABEL[mejor.categoria as keyof typeof CATEGORY_LABEL] ??
      mejor.categoria)
    : resumen.categoriaPropia
      ? (CATEGORY_LABEL[
          resumen.categoriaPropia as keyof typeof CATEGORY_LABEL
        ] ?? resumen.categoriaPropia)
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">
          {reciente ? 'Tu ficha ya está vinculada' : 'Tu ficha'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {resumen.temporada
            ? `Ranking oficial de la RFEE, temporada ${resumen.temporada}`
            : 'Ranking oficial de la RFEE'}
        </p>
      </div>

      {reciente ? (
        <p className="medida flex items-start gap-2 text-sm text-ok">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Hecho. Nada de esto lo has escrito tú: si el puesto y los puntos son
            los tuyos, está bien vinculada.
          </span>
        </p>
      ) : null}

      {/*
        La chapa del marcador: dos cifras grandes y los datos con su rótulo
        debajo.

        Antes eran cuatro celdas de `Marcador`, con el arma y la categoría
        dentro. A 390 px «Florete» en condensada a 48 px empujaba su rótulo
        contra el borde y el navegador cortaba «tu arma» en «tu arm». Y el
        problema de fondo era otro: el marcador es para CIFRAS, y «Florete» no
        es una cifra. El puesto y los puntos sí, y son justamente los dos datos
        que confirman que la ficha es la correcta.
      */}
      <div className="flex flex-col gap-4 rounded-lg border-t border-filete bg-card px-4 py-4">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Cuenta
            valor={mejor?.puesto ?? '—'}
            palabra={
              mejor?.puesto
                ? mejor.deCuantos > 0
                  ? `puesto oficial de ${mejor.deCuantos}`
                  : 'puesto oficial'
                : 'todavía sin puesto'
            }
            tamano="enorme"
            tono={mejor?.puesto ? 'normal' : 'apagado'}
          />
          <Cuenta
            valor={
              mejor?.puntos === null || mejor?.puntos === undefined
                ? '—'
                : puntos(mejor.puntos)
            }
            palabra="puntos oficiales"
            tamano="enorme"
            tono={mejor?.puntos ? 'normal' : 'apagado'}
          />
        </div>

        <Rotulos
          datos={[
            [
              resumen.armas.length === 1 ? 'Tu arma' : 'Tus armas',
              resumen.armas.length > 0
                ? resumen.armas.map((a) => WEAPON_LABEL[a]).join(', ')
                : 'sin asignar',
            ],
            ['Tu categoría', categoria ?? 'sin derivar'],
            [
              resumen.clasificaciones.length === 1
                ? 'Clasificación oficial'
                : 'Clasificaciones oficiales',
              String(resumen.clasificaciones.length),
            ],
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Seccion
          titulo={
            resumen.clasificaciones.length === 1
              ? 'Tu clasificación oficial'
              : 'Tus clasificaciones oficiales'
          }
          contexto={
            resumen.actualizadoEl
              ? `Leída el ${formatDateEs(resumen.actualizadoEl)}`
              : undefined
          }
          className="lg:col-start-1 lg:row-start-1"
        >
          {resumen.clasificaciones.length === 0 ? (
            <p className="medida py-4 text-sm text-muted-foreground">
              Tu ficha está vinculada, pero ninguna fila del ranking oficial
              apunta todavía a ella. Suele significar que no has puntuado esta
              temporada. Aparecerá en cuanto la federación publique un resultado
              con tu licencia.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {resumen.clasificaciones.map((c) => (
                <li
                  key={`${c.arma}-${c.genero}-${c.categoriaOriginal}`}
                  className="flex flex-col gap-3 py-4"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="cifra text-5xl">{c.puesto ?? '—'}</span>
                    <span className="text-xs leading-tight text-muted-foreground">
                      {c.puesto
                        ? c.deCuantos > 0
                          ? `puesto de ${c.deCuantos}`
                          : 'puesto'
                        : 'sin clasificar todavía'}
                    </span>
                  </div>

                  {/* Cada dato con su rótulo, no encadenados con puntos medios. */}
                  <Rotulos
                    datos={[
                      ['Arma', WEAPON_LABEL[c.arma]],
                      ['Género', GENDER_LABEL[c.genero]],
                      [
                        'Categoría',
                        CATEGORY_LABEL[c.categoria as keyof typeof CATEGORY_LABEL] ??
                          c.categoria,
                      ],
                      [
                        'Puntos',
                        <span key="p" className="cifra text-base">
                          {c.puntos === null ? 'no publicado' : puntos(c.puntos)}
                        </span>,
                      ],
                    ]}
                  />

                  {c.urlFuente ? (
                    <a
                      href={c.urlFuente}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-xs text-primary-text underline underline-offset-4"
                    >
                      Verlo en la página de la RFEE
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 pt-5">
            <Button asChild>
              <Link href="/">
                {resumen.armas.length > 0
                  ? `Ver mi calendario de ${WEAPON_LABEL[resumen.armas[0]].toLowerCase()}`
                  : 'Ver el calendario'}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/estado">Ver mi estado</Link>
            </Button>
          </div>
        </Seccion>

        <aside className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <Seccion titulo="Lo que dice tu ficha">
            <div className="flex flex-col gap-3 py-4">
              <Rotulos
                datos={[
                  ['Nombre', resumen.nombre],
                  ['Licencia RFEE', resumen.licencia ?? 'no publicado'],
                  ['Club', resumen.club ?? 'no publicado'],
                  ['Año de nacimiento', String(resumen.anioNacimiento)],
                  [
                    resumen.armas.length === 1 ? 'Arma' : 'Armas',
                    resumen.armas.length > 0
                      ? resumen.armas.map((a) => WEAPON_LABEL[a]).join(', ')
                      : 'ninguna',
                  ],
                  [
                    'Puede competir en',
                    resumen.categoriasElegibles.length > 0
                      ? resumen.categoriasElegibles
                          .map(
                            (c) =>
                              CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c,
                          )
                          .join(', ')
                      : 'sin derivar',
                  ],
                ]}
              />
              <p className="medida text-xs text-muted-foreground">
                {resumen.explicacionCategoria} Todo esto sale del ranking oficial
                de la RFEE; si algo no cuadra, se corrige en la fuente y no aquí.
              </p>
              {varias ? (
                <p className="medida text-xs text-muted-foreground">
                  Tu cuenta gestiona más de un tirador. Arriba sale el primero;
                  el resto están en «Mi estado».
                </p>
              ) : null}
            </div>
          </Seccion>
        </aside>
      </div>
    </div>
  );
}
