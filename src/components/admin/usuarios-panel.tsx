'use client';

import { Download, FileUp, Loader2, Plus, TriangleAlert, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type { AltaReciente, ClubFila } from '@/app/(app)/admin/consultas';
import {
  crearClub,
  crearUsuario,
  importarUsuarios,
  plantillaCsv,
  previsualizarCsv,
  type FilaCsv,
} from '@/app/(app)/admin/usuarios/actions';
import { CampoFecha } from '@/components/admin/campo-fecha';
import { Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Weapon } from '@/lib/auth/session';
import { ageOn, requiresGuardianAccount } from '@/lib/categories';
import { WEAPON_LABEL, cn, formatDateEs } from '@/lib/utils';

/**
 * Altas de usuarios.
 *
 * La regla que manda sobre todo lo demás es el RGPD: en España un menor de 14
 * años no puede consentir el tratamiento por sí mismo, así que no se le crea
 * cuenta. Eso no se explica en una nota al pie: en cuanto la fecha de
 * nacimiento dice que es menor, el formulario cambia solo y pide el correo
 * del tutor, porque un aviso que hay que leer es un aviso que no se lee.
 *
 * La importación nunca escribe a ciegas. Primero se previsualiza fila a fila
 * —qué entraría, qué falla y por qué— y solo después se confirma: una carga
 * de 200 filas sin mirar es la forma más rápida de llenar la base de basura.
 */

const ARMAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
const SIN_CLUB = '__sin_club__';

const ROLES = [
  { valor: 'athlete', etiqueta: 'Tirador' },
  { valor: 'guardian', etiqueta: 'Padre, madre o tutor' },
  { valor: 'club', etiqueta: 'Responsable de club' },
  { valor: 'admin', etiqueta: 'Administración' },
];

const ROL_LABEL: Record<string, string> = {
  admin: 'Administración',
  coach: 'Seleccionador',
  club: 'Responsable de club',
  athlete: 'Tirador',
  guardian: 'Padre, madre o tutor',
};

export function UsuariosPanel({
  clubes,
  altas,
}: {
  clubes: ClubFila[];
  altas: AltaReciente[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Tabs defaultValue="individual">
        <TabsList className="no-scrollbar max-w-full overflow-x-auto">
          <TabsTrigger value="individual">Alta individual</TabsTrigger>
          <TabsTrigger value="csv">Importar un CSV</TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="pt-2">
          <FormularioAlta clubes={clubes} />
        </TabsContent>

        <TabsContent value="csv" className="pt-2">
          <ImportadorCsv />
        </TabsContent>
      </Tabs>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg">Últimas altas</h2>
          <p className="text-sm text-muted-foreground">
            Para comprobar de un vistazo que ha entrado lo que tocaba.
          </p>
        </div>

        {altas.length === 0 ? (
          <Vacio
            titulo="Todavía no hay ninguna cuenta"
            explicacion="Da de alta a la primera persona con el formulario de arriba, o importa el listado entero desde un CSV."
          />
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {altas.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <div className="flex min-w-40 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{a.fullName}</span>
                    <Badge variant="secondary" className="font-normal">
                      {ROL_LABEL[a.role] ?? a.role}
                    </Badge>
                    {a.inviteStatus === 'revocada' ? (
                      <Badge variant="destructive" className="font-normal">
                        Acceso revocado
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{a.email}</span>
                    {a.clubNombre ? (
                      <span className="min-w-0 truncate">{a.clubNombre}</span>
                    ) : null}
                  </span>
                  {a.fichas.length > 0 ? (
                    <span className="truncate text-xs text-muted-foreground">
                      Fichas de tirador: {a.fichas.join(', ')}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateEs(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------ alta individual ---

function FormularioAlta({ clubes }: { clubes: ClubFila[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creandoClub, setCreandoClub] = React.useState(false);

  const [rol, setRol] = React.useState('athlete');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [clubId, setClubId] = React.useState(SIN_CLUB);
  const [birthDate, setBirthDate] = React.useState('');
  const [gender, setGender] = React.useState('');
  const [rfeeLicense, setRfeeLicense] = React.useState('');
  const [armas, setArmas] = React.useState<Weapon[]>([]);
  const [guardianEmail, setGuardianEmail] = React.useState('');
  const [guardianName, setGuardianName] = React.useState('');

  const esTirador = rol === 'athlete';
  const edad = birthDate ? ageOn(birthDate) : null;
  const menor = Boolean(esTirador && birthDate && requiresGuardianAccount(birthDate));

  function limpiar() {
    setFirstName('');
    setLastName('');
    setEmail('');
    setBirthDate('');
    setGender('');
    setRfeeLicense('');
    setArmas([]);
    setGuardianEmail('');
    setGuardianName('');
    setError(null);
  }

  async function enviar() {
    setOcupado(true);
    setError(null);

    const datos = new FormData();
    datos.set('firstName', firstName);
    datos.set('lastName', lastName);
    datos.set('email', email);
    datos.set('role', rol);
    datos.set('clubId', clubId === SIN_CLUB ? '' : clubId);
    datos.set('birthDate', birthDate);
    datos.set('gender', gender);
    datos.set('rfeeLicense', rfeeLicense);
    datos.set('guardianEmail', guardianEmail);
    datos.set('guardianName', guardianName);
    for (const arma of armas) datos.append('weapons', arma);

    try {
      const resultado = await crearUsuario(datos);
      if (resultado.ok) {
        toast.success(resultado.message, { duration: 8000 });
        limpiar();
        router.refresh();
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se ha podido dar de alta. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-nombre">Nombre</Label>
          <Input
            id="alta-nombre"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Lucía"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-apellidos">Apellidos</Label>
          <Input
            id="alta-apellidos"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Fernández Soto"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-rol">Papel</Label>
          <Select value={rol} onValueChange={setRol}>
            <SelectTrigger id="alta-rol" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Los seleccionadores se dan de alta en Ajustes, con su arma.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alta-correo">Correo</Label>
          <Input
            id="alta-correo"
            type="email"
            inputMode="email"
            value={email}
            disabled={menor}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lucia@ejemplo.es"
          />
          {menor ? (
            <p className="text-xs text-warn">
              Por debajo de 14 años no se le crea cuenta, así que este correo se ignora.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="alta-club">Club</Label>
          <div className="flex gap-2">
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger id="alta-club" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CLUB}>Sin club</SelectItem>
                {clubes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.regionalFederation ? ` · ${c.regionalFederation}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => setCreandoClub(true)}
            >
              <Plus /> Nuevo club
            </Button>
          </div>
        </div>

        {esTirador ? (
          <>
            <CampoFecha
              id="alta-nacimiento"
              etiqueta="Fecha de nacimiento"
              valorIso={birthDate}
              onChange={setBirthDate}
              ayuda="Obligatoria: la categoría se deriva de ella, nunca se escribe a mano."
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-genero">Género</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger id="alta-genero" className="w-full">
                  <SelectValue placeholder="Elige" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="F">Femenino</SelectItem>
                  <SelectItem value="M">Masculino</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Determina en qué pruebas puede inscribirse.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-licencia">Licencia RFEE</Label>
              <Input
                id="alta-licencia"
                value={rfeeLicense}
                onChange={(e) => setRfeeLicense(e.target.value)}
                placeholder="LFS01234"
              />
              <p className="text-xs text-muted-foreground">
                Es la clave con la que se emparejan sus resultados. Sin ella habrá que
                asignarlos a mano.
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Armas</legend>
              <div className="flex flex-wrap gap-4">
                {ARMAS.map((arma) => (
                  <div key={arma} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`alta-arma-${arma}`}
                      checked={armas.includes(arma)}
                      onCheckedChange={(valor) =>
                        setArmas(
                          valor === true
                            ? [...armas, arma]
                            : armas.filter((a) => a !== arma),
                        )
                      }
                    />
                    <Label htmlFor={`alta-arma-${arma}`} className="font-normal">
                      {WEAPON_LABEL[arma]}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}
      </div>

      {menor ? (
        <div className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn/5 p-3">
          <p className="medida text-sm text-warn">
            {firstName || 'Este tirador'} tiene {edad} años. Por debajo de 14 la cuenta
            va a nombre del padre, madre o tutor y la ficha queda vinculada, sin acceso
            propio. No es configurable: lo impone el RGPD.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-tutor-correo">Correo del tutor</Label>
              <Input
                id="alta-tutor-correo"
                type="email"
                inputMode="email"
                value={guardianEmail}
                onChange={(e) => setGuardianEmail(e.target.value)}
                placeholder="madre@ejemplo.es"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-tutor-nombre">Nombre del tutor</Label>
              <Input
                id="alta-tutor-nombre"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Ana Soto"
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="medida rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={ocupado} onClick={enviar}>
          {ocupado ? <Loader2 className="animate-spin" /> : null}
          Dar de alta
        </Button>
        <Button variant="ghost" onClick={limpiar} disabled={ocupado}>
          Vaciar el formulario
        </Button>
      </div>

      <DialogClub abierto={creandoClub} onCerrar={() => setCreandoClub(false)} />
    </div>
  );
}

function DialogClub({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = React.useState('');
  const [federacion, setFederacion] = React.useState('');
  const [correo, setCorreo] = React.useState('');
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function enviar() {
    setOcupado(true);
    setError(null);
    const datos = new FormData();
    datos.set('name', nombre);
    datos.set('regionalFederation', federacion);
    datos.set('contactEmail', correo);
    try {
      const resultado = await crearClub(datos);
      if (resultado.ok) {
        toast.success(resultado.message);
        setNombre('');
        setFederacion('');
        setCorreo('');
        onCerrar();
        router.refresh();
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se ha podido crear el club.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo club</DialogTitle>
          <DialogDescription>
            Sin club en la lista no se puede terminar de dar de alta a casi nadie, así
            que se crea aquí mismo sin perder lo que ya has escrito.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="club-nombre">Nombre</Label>
            <Input
              id="club-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Sala de Armas de Valencia"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="club-federacion">Federación autonómica</Label>
            <Input
              id="club-federacion"
              value={federacion}
              onChange={(e) => setFederacion(e.target.value)}
              placeholder="Comunidad Valenciana"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="club-correo">Correo de contacto</Label>
            <Input
              id="club-correo"
              type="email"
              inputMode="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="contacto@club.es"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={enviar}>
            {ocupado ? <Loader2 className="animate-spin" /> : null}
            Crear el club
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------- importación ---

type Previsualizacion = {
  filas: FilaCsv[];
  validas: number;
  conErrores: number;
  separador: string;
  cabeceraDetectada: string[];
};

function ImportadorCsv() {
  const router = useRouter();
  const [texto, setTexto] = React.useState('');
  const [previa, setPrevia] = React.useState<Previsualizacion | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [soloProblemas, setSoloProblemas] = React.useState(false);

  async function leerFichero(fichero: File) {
    const contenido = await fichero.text();
    setTexto(contenido);
    await revisar(contenido);
  }

  async function revisar(contenido = texto) {
    setOcupado(true);
    setError(null);
    setPrevia(null);
    try {
      const resultado = await previsualizarCsv(contenido);
      if (resultado.ok) {
        setPrevia({
          filas: resultado.filas,
          validas: resultado.validas,
          conErrores: resultado.conErrores,
          separador: resultado.separador,
          cabeceraDetectada: resultado.cabeceraDetectada,
        });
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se ha podido leer el fichero.');
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    try {
      const resultado = await importarUsuarios(texto);
      if (resultado.ok) {
        toast.success(resultado.message, { duration: 10_000 });
        setTexto('');
        setPrevia(null);
        router.refresh();
      } else {
        toast.error(resultado.error, { duration: 8000 });
      }
    } catch {
      toast.error('No se ha podido importar.');
    } finally {
      setOcupado(false);
    }
  }

  async function descargarPlantilla() {
    try {
      const contenido = await plantillaCsv();
      const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'plantilla-usuarios.csv';
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se ha podido generar la plantilla.');
    }
  }

  const visibles =
    previa && soloProblemas
      ? previa.filas.filter((f) => f.errores.length > 0 || f.avisos.length > 0)
      : (previa?.filas ?? []);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={descargarPlantilla}>
            <Download /> Descargar la plantilla
          </Button>
          <Label
            htmlFor="csv-fichero"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent"
          >
            <FileUp className="size-4" /> Elegir un fichero
          </Label>
          <input
            id="csv-fichero"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const fichero = e.target.files?.[0];
              if (fichero) void leerFichero(fichero);
            }}
          />
          <p className="text-xs text-muted-foreground">
            También puedes pegar el contenido abajo. Separador «;» o «,»: se detecta
            solo.
          </p>
        </div>

        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          className="font-mono text-xs"
          aria-label="Contenido del CSV"
          placeholder={'nombre;apellidos;email;rol;club;fecha_nacimiento;genero;armas;licencia_rfee;email_tutor;nombre_tutor'}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado || texto.trim().length === 0}
            onClick={() => revisar()}
          >
            {ocupado ? <Loader2 className="animate-spin" /> : null}
            Previsualizar
          </Button>
          {previa && previa.validas > 0 ? (
            <Button size="sm" disabled={ocupado} onClick={importar}>
              <Upload />
              {previa.validas === 1
                ? 'Importar la fila válida'
                : `Importar las ${previa.validas} válidas`}
            </Button>
          ) : null}
        </div>

        {error ? (
          <p className="medida rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {previa ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm">
              <span className="cifra text-2xl text-ok">{previa.validas}</span>{' '}
              <span className="text-muted-foreground">entrarían</span>
            </span>
            <span className="text-sm">
              <span
                className={cn(
                  'cifra text-2xl',
                  previa.conErrores > 0 ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {previa.conErrores}
              </span>{' '}
              <span className="text-muted-foreground">se quedarían fuera</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Separador «{previa.separador}» · columnas leídas:{' '}
              {previa.cabeceraDetectada.join(', ')}
            </span>
            {previa.conErrores > 0 || previa.filas.some((f) => f.avisos.length > 0) ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="csv-solo-problemas"
                  checked={soloProblemas}
                  onCheckedChange={(v) => setSoloProblemas(v === true)}
                />
                <Label htmlFor="csv-solo-problemas" className="font-normal">
                  Ver solo las filas con algo que mirar
                </Label>
              </div>
            ) : null}
          </div>

          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {visibles.map((f) => (
              <li
                key={f.linea}
                className={cn(
                  'flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5',
                  f.errores.length > 0 && 'bg-destructive/5',
                )}
              >
                <span className="cifra w-8 shrink-0 text-sm text-muted-foreground">
                  {f.linea}
                </span>

                <div className="flex min-w-44 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {`${f.firstName} ${f.lastName}`.trim() || 'Fila sin nombre'}
                    </span>
                    {f.role ? (
                      <Badge variant="secondary" className="font-normal">
                        {ROL_LABEL[f.role] ?? f.role}
                      </Badge>
                    ) : null}
                    {f.requiereTutor ? (
                      <Badge variant="outline" className="font-normal">
                        Menor de 14
                      </Badge>
                    ) : null}
                    {f.weapons.map((a) => (
                      <Badge key={a} variant="outline" className="font-normal">
                        {WEAPON_LABEL[a]}
                      </Badge>
                    ))}
                  </span>
                  {/* Cada dato en su hueco, no encadenados con puntos. */}
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {f.requiereTutor
                        ? f.guardianEmail || 'sin correo de tutor'
                        : f.email || 'sin correo'}
                    </span>
                    {f.birthDate ? <span>{formatDateEs(f.birthDate)}</span> : null}
                    {f.clubName ? (
                      <span className="min-w-0 truncate">{f.clubName}</span>
                    ) : null}
                    {f.rfeeLicense ? (
                      <span>Licencia {f.rfeeLicense}</span>
                    ) : null}
                  </span>

                  {f.errores.map((e, i) => (
                    <span key={`e-${i}`} className="text-xs text-danger">
                      {e}
                    </span>
                  ))}
                  {f.avisos.map((a, i) => (
                    <span key={`a-${i}`} className="text-xs text-warn">
                      {a}
                    </span>
                  ))}
                </div>

                <span className="shrink-0 text-xs">
                  {f.errores.length > 0 ? (
                    <span className="flex items-center gap-1 text-danger">
                      <TriangleAlert className="size-3.5" aria-hidden /> No entra
                    </span>
                  ) : (
                    <span className="text-ok">Entra</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
