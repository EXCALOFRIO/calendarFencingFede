import { Badge } from '@/components/ui/badge';
import type { AthleteSummary } from '@/lib/auth/session';
import type { EligibilityResult } from '@/lib/categories';
import { ageOn } from '@/lib/categories';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
} from '@/lib/utils';

export function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Licencia: número, validez y, si procede, el aviso de caducada. */
function Licencia({
  etiqueta,
  numero,
  validaHasta,
  hoy,
}: {
  etiqueta: string;
  numero: string | null;
  validaHasta: string | null;
  hoy: string;
}) {
  const caducada = Boolean(validaHasta && validaHasta < hoy);

  return (
    <Dato etiqueta={etiqueta}>
      <span className={cn(caducada && 'text-danger')}>
        {numero ?? 'No registrada'}
      </span>
      {validaHasta ? (
        <span
          className={cn(
            'block text-xs',
            caducada ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {caducada ? 'Caducó el' : 'Válida hasta el'} {formatDateEs(validaHasta)}
        </span>
      ) : numero ? (
        <span className="block text-xs text-muted-foreground">
          Validez no registrada
        </span>
      ) : null}
    </Dato>
  );
}

/**
 * Ficha de un tirador de la cuenta.
 *
 * La categoría no se guarda: se deriva del año de nacimiento con la tabla de
 * la temporada, así que se enseña junto a la explicación de cómo sale. Si
 * alguien no está de acuerdo con su categoría, lo que hay que mirar es la
 * tabla, no esta pantalla.
 */
export function FichaTirador({
  atleta,
  categorias,
  hoy,
}: {
  atleta: AthleteSummary;
  categorias: EligibilityResult | null;
  hoy: string;
}) {
  const propia = categorias?.own
    ? (CATEGORY_LABEL[categorias.own as keyof typeof CATEGORY_LABEL] ??
      categorias.own)
    : null;

  return (
    <article className="flex gap-4 py-5">
      {/*
        La categoría, en cifra de marcador.

        Es el dato del que depende todo lo demás —a qué pruebas te puedes
        apuntar y en qué ranking sales— y estaba en un `text-lg` dentro de
        una rejilla de cuatro columnas idénticas, indistinguible de la fecha
        de nacimiento. Aquí manda, y al lado va la palabra pequeña.
      */}
      {/*
        Va el CÓDIGO, no la etiqueta larga.

        Con «Absoluto» a `text-4xl` la palabra se salía de su columna y se
        montaba encima del nombre del tirador. `.cifra` es para marcadores:
        admite «M17» o «ABS», no una palabra de ocho letras. El nombre
        legible se queda debajo, en pequeño, que es donde corresponde.
      */}
      <div className="w-20 shrink-0 overflow-hidden">
        <span
          className={cn(
            'cifra block text-4xl',
            !categorias?.own && 'text-muted-foreground',
          )}
        >
          {categorias?.own ?? '—'}
        </span>
        <span className="mt-1 block text-xs leading-tight text-muted-foreground">
          {!categorias?.own
            ? 'categoría sin calcular'
            : propia && propia !== categorias.own
              ? propia
              : 'su categoría'}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg">{atleta.fullName}</h3>
          <p className="text-sm text-muted-foreground">
            {atleta.clubName ?? 'Sin club asignado'}
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Dato etiqueta="Nacimiento">
            {formatDateEs(atleta.birthDate)}
            <span className="block text-xs text-muted-foreground">
              <span className="cifra text-sm text-foreground">
                {ageOn(atleta.birthDate)}
              </span>{' '}
              años
            </span>
          </Dato>

          <Dato etiqueta="Género">{GENDER_LABEL[atleta.gender]}</Dato>

          <Dato etiqueta="Armas">
            {atleta.weapons.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {atleta.weapons.map((w) => (
                  <Badge key={w} variant="outline">
                    {WEAPON_LABEL[w]}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Ninguna registrada</span>
            )}
          </Dato>

          {categorias && categorias.eligible.length > 0 ? (
            <Dato etiqueta="Puede competir en">
              <span className="flex flex-wrap gap-1">
                {categorias.eligible.map((c) => (
                  <Badge
                    key={c}
                    variant={c === categorias.own ? 'secondary' : 'outline'}
                  >
                    {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
                  </Badge>
                ))}
              </span>
            </Dato>
          ) : null}
        </dl>

        {categorias ? (
          <p className="medida text-sm text-muted-foreground">
            {categorias.explanation}
          </p>
        ) : null}

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Licencia
            etiqueta="Licencia RFEE"
            numero={atleta.rfeeLicense}
            validaHasta={atleta.rfeeLicenseValidUntil}
            hoy={hoy}
          />
          <Licencia
            etiqueta="Licencia FIE"
            numero={atleta.fieLicense}
            validaHasta={atleta.fieLicenseValidUntil}
            hoy={hoy}
          />
          <Dato etiqueta="Consentimiento de datos">
            {atleta.consentSignedAt ? (
              `Firmado el ${formatDateEs(atleta.consentSignedAt)}`
            ) : (
              <span className="text-danger">Sin firmar</span>
            )}
          </Dato>
        </dl>
      </div>
    </article>
  );
}
