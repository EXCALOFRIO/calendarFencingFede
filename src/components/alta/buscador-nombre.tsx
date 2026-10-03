import { CircleUser, Search, TriangleAlert, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { confirmarQueSoyYo } from '@/app/(app)/alta/acciones';
import { Rotulos } from '@/components/estado/piezas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CandidatoNombre, ResultadoNombres } from '@/lib/altas/por-nombre';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { BotonSoyYo, FalloAlVincular } from './boton-soy-yo';

/**
 * «¿Cómo te llamas?» y «¿eres tú?».
 *
 * Es literalmente lo que pidió el usuario: *«que le pregunten al entrar su
 * nombre… y de ahí que pille de la lista aunque no lo haya escrito perfecto,
 * le pregunte "¿eres tú?"»*. Un campo, y botones de «Sí, soy yo». Antes había
 * que sacarse el carné de la RFEE del bolsillo para poder entrar a ver el
 * calendario.
 *
 * -------------------------------------------------------------------------
 * BUSCAR ES UN GET; VINCULAR ES LO ÚNICO QUE ESCRIBE
 * -------------------------------------------------------------------------
 * La búsqueda es un formulario GET normal a `/alta?q=…` y se pinta en el
 * servidor. No es purismo: buscarse es leer, y ponerlo en la URL trae tres
 * cosas gratis que con una acción de cliente había que fabricar —funciona sin
 * JavaScript, se puede recargar sin perder la lista, y el botón «atrás» del
 * móvil hace lo que uno espera—. Lo único que escribe es «Sí, soy yo», y eso
 * sí es una acción de servidor, que es donde tiene que estar un cambio.
 *
 * -------------------------------------------------------------------------
 * LA DECLARACIÓN PROPIA NO CONFIRMA LA IDENTIDAD
 * -------------------------------------------------------------------------
 * Aunque la búsqueda devuelva un único candidato con el nombre exacto, NO se
 * vincula sola. El botón guarda una solicitud sin permisos; la dirección
 * técnica verifica la identidad por una vía independiente y aprueba el enlace.
 *
 * De cada candidato se enseña solo lo que sirve para reconocerse —nombre
 * publicado, arma, categoría, club y el AÑO de nacimiento— porque en estas
 * listas hay menores de edad. Nunca la fecha completa, nunca una licencia,
 * nunca un correo.
 */
export function BuscadorNombre({
  escrito,
  resultado,
  fallo,
  nombreCuenta,
  esPersonal,
}: {
  /** Lo que se escribió en el campo, o cadena vacía si todavía no se ha buscado. */
  escrito: string;
  resultado: ResultadoNombres | null;
  /** Por qué no se pudo vincular, si se intentó y no se pudo. */
  fallo: string | null;
  nombreCuenta: string;
  /** La cuenta es de un tirador o de un tutor, no de la dirección técnica. */
  esPersonal: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Vincula tu ficha</h1>
        <p className="text-sm text-muted-foreground">
          Dinos tu nombre y búscate en las listas oficiales
        </p>
      </div>

      {/*
        Dos líneas, no siete: a 390 px cada párrafo de explicación empuja el
        campo —que es a lo que se viene— por debajo del pliegue.
      */}
      <p className="medida text-sm text-muted-foreground">
        Tu cuenta no está unida a ninguna ficha, así que el calendario no sabe
        cuál es tu arma. Escribe tu nombre como te salga: se busca en las listas
        oficiales de la RFEE y de la FIE, y las erratas se perdonan.
        La dirección técnica revisará tu identidad antes de vincular la ficha.
      </p>

      {/*
        El campo viene con el nombre de la cuenta ya escrito.

        No es un adorno: quien acaba de registrarse ya ha teclado su nombre una
        vez y volver a pedírselo es preguntar dos veces lo mismo. Se puede
        corregir —la cuenta puede decir «Carlos L.» y el ranking «CARLOS
        LLAVADOR FERNANDEZ»—, que es justo lo que este buscador perdona.

        Y se topa a 22 rem: un nombre es un dato corto, y sin tope a 1440 px el
        campo medía 1.290 px con el botón perdido en la otra punta.
      */}
      <form method="get" action="/alta" className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5 sm:max-w-88">
          <Label htmlFor="mi-nombre">¿Cómo te llamas?</Label>
          <Input
            id="mi-nombre"
            name="q"
            defaultValue={escrito || nombreCuenta}
            placeholder="Nombre y apellidos"
            autoComplete="name"
            maxLength={160}
            spellCheck={false}
            aria-invalid={resultado?.ok === false}
            aria-describedby={resultado?.ok === false ? 'error-nombre' : undefined}
          />
        </div>
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          Buscarme
        </Button>
      </form>

      {resultado && !resultado.ok ? (
        <p
          id="error-nombre"
          role="alert"
          className="medida flex items-start gap-2 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{resultado.error}</span>
        </p>
      ) : null}

      {fallo ? <FalloAlVincular mensaje={fallo} /> : null}

      {resultado?.ok ? (
        <Candidatos
          candidatos={resultado.candidatos}
          hayMas={resultado.hayMas}
          escrito={escrito}
        />
      ) : null}

      <NoApareces esPersonal={esPersonal} />
    </div>
  );
}

/** Lo que devolvió la búsqueda, o por qué no devolvió nada. */
function Candidatos({
  candidatos,
  hayMas,
  escrito,
}: {
  candidatos: CandidatoNombre[];
  hayMas: boolean;
  escrito: string;
}) {
  /*
    «No apareces» es una respuesta, no un error.

    Mucha gente de verdad no está en estas listas: un M13 que empieza, alguien
    que no ha puntuado esta temporada. Si aquí se pintara un aviso rojo
    parecería que ha fallado algo, y lo que ha pasado es que la lista no le
    incluye. Y nunca se inventa un parecido para no dejar la pantalla vacía.
  */
  if (candidatos.length === 0) {
    return (
      <section className="flex min-w-0 flex-col">
        <div className="border-b pb-2">
          <h2 className="text-xl">No apareces en las listas oficiales</h2>
        </div>
        <p className="medida py-4 text-sm text-muted-foreground">
          Con «{escrito}» no encaja nadie en la clasificación de la RFEE de esta
          temporada ni en las listas de la FIE. Prueba con tu nombre y un solo
          apellido. Y ten en cuenta que en esas listas solo están los que han
          competido: si empiezas en M13 o no has puntuado todavía, no sales, y
          entonces la ficha te la tiene que crear la dirección técnica.
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 className="text-xl">
          {candidatos.length === 1 ? '¿Eres tú?' : '¿Eres alguno de estos?'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {candidatos.length === 1
            ? 'Comprueba el arma y el año antes de confirmar'
            : 'Puede haber homónimos: mira el arma, el club y el año'}
        </p>
      </div>

      <ul className="flex flex-col divide-y">
        {candidatos.map((c) => (
          <li key={c.clave} className="flex min-w-0 flex-col gap-2.5 py-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-base font-medium">{c.nombre}</p>
              {/*
                El nombre tal y como lo publica la fuente: la FIE escribe
                «CASAUS PIELAGO Jorge» y la RFEE «JORGE CASAUS PIELAGO». Verlo
                es parte de reconocerse, y además deja auditar el emparejado sin
                abrir la base de datos.
              */}
              <span className="min-w-0 text-xs text-muted-foreground">
                {c.fuente === 'RANKING_RFEE' ? 'en la RFEE, ' : 'en la FIE, '}«
                {c.nombrePublicado}»
              </span>
            </div>

            {/*
              Los datos que distinguen a dos homónimos, cada uno con su rótulo.
              El AÑO de nacimiento y no la fecha: para distinguir sobra el año,
              y la fecha completa de un menor no se pinta en una pantalla a la
              que se llega escribiendo un apellido.
            */}
            <Rotulos
              disposicion="linea"
              datos={[
                ['Nació en', c.anioNacimiento ?? 'no publicado'],
                [
                  c.armas.length === 1 ? 'Arma' : 'Armas',
                  c.armas.length > 0
                    ? c.armas.map((a) => WEAPON_LABEL[a]).join(', ')
                    : 'no publicada',
                ],
                [
                  c.categorias.length === 1 ? 'Categoría' : 'Categorías',
                  c.categorias.length > 0
                    ? c.categorias
                        .map(
                          (k) =>
                            CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k,
                        )
                        .join(', ')
                    : 'no publicada',
                ],
                ['Club', c.club ?? 'no publicado'],
                [
                  'Mejor puesto',
                  c.mejorPuesto === null ? (
                    'sin clasificar'
                  ) : (
                    <span key="p" className="cifra text-base">
                      {c.mejorPuesto}.º
                    </span>
                  ),
                ],
              ]}
            />

            <p className="text-xs text-muted-foreground">
              {c.fuente === 'RANKING_RFEE'
                ? c.tambienEnLaFie
                  ? 'De la clasificación oficial de la RFEE, y también en las listas de la FIE.'
                  : 'De la clasificación oficial de la RFEE.'
                : 'De las listas de la FIE. No estás en el ranking de la RFEE de esta temporada.'}
            </p>

            {c.yaVinculado ? (
              <p className="medida flex items-start gap-2 text-sm text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Esta ficha ya está vinculada a una cuenta. Si es la tuya, entra
                  con ella; si no lo es, escribe a la dirección técnica para que
                  lo revise.
                </span>
              </p>
            ) : c.faltaDato ? (
              <p className="medida flex items-start gap-2 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  De esta ficha la fuente no publica {c.faltaDato}, y sin eso no
                  se puede crear tu ficha sin inventárselo. Pídele la
                  vinculación a la dirección técnica.
                </span>
              </p>
            ) : (
              /*
                Un formulario por candidato, con la clave y lo que se escribió
                en campos ocultos. Del navegador no llega ninguna cuenta: el
                perfil sale de la sesión en la acción. Si llegara de fuera, esto
                sería «vincúlale la ficha de Carlos Llavador a quien yo diga».
              */
              <form action={confirmarQueSoyYo}>
                <input type="hidden" name="clave" value={c.clave} />
                <input type="hidden" name="escrito" value={escrito} />
                <BotonSoyYo />
              </form>
            )}
          </li>
        ))}
      </ul>

      {/*
        Cinco como máximo, y se dice cuántos se han dejado fuera.

        Medido con los nombres reales: «garcia» casa con 94 personas. Enseñar
        las 94 convertiría esto en un listado de gente, así que el tope es de
        seguridad; pero callarse que hay más es peor, porque quien no se ve en
        la lista se queda pensando que no está.
      */}
      {hayMas ? (
        <p className="medida pt-3 text-xs text-muted-foreground">
          Hay más gente que encaja con «{escrito}» y solo se enseñan cinco. Si
          no te ves, escribe tu nombre y tus dos apellidos.
        </p>
      ) : null}

      <p className="medida flex items-start gap-2 pt-3 text-xs text-muted-foreground">
        <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          El botón guarda una solicitud, no concede acceso a esta ficha.
          La dirección técnica debe verificar tu identidad por una vía independiente
          antes de aprobarla. Cada cuenta puede tener una solicitud pendiente.
        </span>
      </p>
    </section>
  );
}

/**
 * La vía muerta que hay que evitar.
 *
 * Quien no está en ninguna lista oficial se queda mirando la pantalla sin
 * saber qué hacer, y es justo quien más ayuda necesita. Va callado y al final:
 * antes de buscar nada, pesaba lo mismo que la acción principal.
 */
function NoApareces({ esPersonal }: { esPersonal: boolean }) {
  return (
    <div className="border-t pt-4">
      <p className="medida flex items-start gap-2 text-xs text-muted-foreground">
        <CircleUser className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          ¿No te encuentras por tu nombre? En las listas oficiales solo están
          los que han competido, así que es normal no salir si empiezas en M13 o
          no has puntuado todavía. Pídele a la dirección técnica que te cree la
          ficha; en cuanto la tengas, esta pantalla te enseñará tus datos.
          {esPersonal
            ? ' Mientras tanto el calendario funciona, aunque sin filtrar por tu arma.'
            : ''}{' '}
          {/*
            La búsqueda por licencia también exige revisión de identidad.
          */}
          <Link
            href="/alta?con=licencia"
            className="text-primary-text underline underline-offset-4"
          >
            También puedes buscar con tu número de licencia de la RFEE, con la misma revisión.
          </Link>
        </span>
      </p>
    </div>
  );
}
