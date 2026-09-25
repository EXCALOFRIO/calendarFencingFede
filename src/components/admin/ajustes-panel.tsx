'use client';

import {
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  UserMinus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type { MiembroEquipo } from '@/app/(app)/admin/consultas';
import {
  actualizarMiembroEquipo,
  crearMiembroEquipo,
  quitarDelEquipo,
  restaurarAcceso,
  revocarAcceso,
} from '@/app/(app)/admin/ajustes/actions';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Weapon } from '@/lib/auth/session';
import { WEAPON_LABEL, cn, formatDateEs } from '@/lib/utils';

/**
 * Equipo: quién entra al panel y con qué alcance.
 *
 * Se enseña primero POR ARMA y no por persona. El fallo que importa aquí no
 * es «Fulano tiene demasiados permisos», es «el sable se ha quedado sin
 * seleccionador y nadie lo ha notado»: una lista de personas ordenada
 * alfabéticamente esconde justo eso.
 *
 * Tres acciones que se parecen y NO son la misma, así que están separadas y
 * cada una dice lo que hace:
 *   · quitar del equipo  → pierde el panel, sigue entrando en la aplicación.
 *   · revocar el acceso  → no vuelve a entrar, conserva rol y datos.
 *   · restaurar          → deshace lo anterior.
 */

const ARMAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];

type Borrador = {
  profileId: string | null;
  fullName: string;
  email: string;
  role: 'admin' | 'coach';
  weapons: Weapon[];
};

/**
 * Quitar permisos se confirma antes de hacerse.
 *
 * Las dos acciones son reversibles, pero «revocar el acceso» deja a alguien
 * fuera de la aplicación sin avisarle: merece una pregunta, no un clic.
 */
type Confirmacion = {
  miembro: MiembroEquipo;
  accion: 'revocar' | 'quitar';
} | null;

const VACIO: Borrador = {
  profileId: null,
  fullName: '',
  email: '',
  role: 'coach',
  weapons: [],
};

export function AjustesPanel({ equipo }: { equipo: MiembroEquipo[] }) {
  const router = useRouter();
  const [borrador, setBorrador] = React.useState<Borrador | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [existente, setExistente] = React.useState<{
    profileId: string;
    fullName: string;
  } | null>(null);
  const [confirmacion, setConfirmacion] = React.useState<Confirmacion>(null);

  const administradores = equipo.filter((m) => m.role === 'admin');
  const seleccionadores = equipo.filter((m) => m.role === 'coach');

  async function guardar() {
    if (!borrador) return;
    setOcupado(true);
    setError(null);

    const datos = new FormData();
    datos.set('fullName', borrador.fullName);
    datos.set('email', borrador.email);
    datos.set('role', borrador.role);
    for (const arma of borrador.weapons) datos.append('weapons', arma);

    try {
      if (borrador.profileId) {
        datos.set('profileId', borrador.profileId);
        const resultado = await actualizarMiembroEquipo(datos);
        if (resultado.ok) {
          toast.success(resultado.message);
          setBorrador(null);
          router.refresh();
        } else {
          setError(resultado.error);
        }
        return;
      }

      const resultado = await crearMiembroEquipo(datos);
      if (resultado.ok) {
        toast.success(resultado.message);
        setBorrador(null);
        router.refresh();
      } else {
        setError(resultado.error);
        setExistente(
          resultado.yaExiste
            ? {
                profileId: resultado.yaExiste.profileId,
                fullName: resultado.yaExiste.fullName,
              }
            : null,
        );
      }
    } catch {
      setError('No se ha podido guardar. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  /** Le da el alcance del formulario al perfil que ya existía con ese correo. */
  async function darAlcanceAlExistente() {
    if (!borrador || !existente) return;
    setOcupado(true);
    setError(null);

    const datos = new FormData();
    datos.set('profileId', existente.profileId);
    datos.set('fullName', borrador.fullName);
    datos.set('role', borrador.role);
    for (const arma of borrador.weapons) datos.append('weapons', arma);

    try {
      const resultado = await actualizarMiembroEquipo(datos);
      if (resultado.ok) {
        toast.success(resultado.message);
        setBorrador(null);
        setExistente(null);
        router.refresh();
      } else {
        setError(resultado.error);
      }
    } catch {
      setError('No se ha podido guardar. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  async function ejecutar(
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) {
    setOcupado(true);
    try {
      const resultado = await accion();
      if (resultado.ok) {
        toast.success(resultado.message ?? 'Hecho.');
        router.refresh();
      } else {
        toast.error(resultado.error ?? 'No se ha podido aplicar.', { duration: 8000 });
      }
    } catch {
      toast.error('No se ha podido aplicar el cambio.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setBorrador({ ...VACIO });
            setError(null);
            setExistente(null);
          }}
        >
          <Plus /> Dar de alta a alguien
        </Button>
        <p className="medida text-xs text-muted-foreground">
          El alta no manda ningún correo: crear el perfil es justo lo que abre la puerta,
          porque la pantalla de acceso solo envía código a correos que ya tienen perfil.
        </p>
      </div>

      {/* Cobertura por arma. Lo primero, porque el hueco es lo que duele. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Seleccionador de cada arma</h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {ARMAS.map((arma) => {
            const suyos = seleccionadores.filter((s) => s.weapons.includes(arma));
            return (
              <li
                key={arma}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border px-3 py-2.5',
                  suyos.length === 0 ? 'border-warn/40 bg-warn/5' : 'bg-card',
                )}
              >
                <span className="text-sm font-medium">{WEAPON_LABEL[arma]}</span>
                {suyos.length === 0 ? (
                  <span className="text-xs text-warn">
                    Sin seleccionador. Nadie ve a estos tiradores al entrar.
                  </span>
                ) : (
                  suyos.map((s) => (
                    <span key={s.profileId} className="flex flex-col">
                      <span className="truncate text-sm">{s.fullName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.email}
                      </span>
                    </span>
                  ))
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <BloqueEquipo
        titulo="Dirección técnica"
        explicacion="Ve el panel entero y a todos los tiradores. Siempre tiene que quedar al menos una cuenta."
        miembros={administradores}
        ocupado={ocupado}
        onEditar={(m) => {
          setBorrador({
            profileId: m.profileId,
            fullName: m.fullName,
            email: m.email,
            role: m.role,
            weapons: m.weapons,
          });
          setError(null);
          setExistente(null);
        }}
        onEjecutar={ejecutar}
        onConfirmar={setConfirmacion}
      />

      <BloqueEquipo
        titulo="Seleccionadores"
        explicacion="Entran y ven primero a los tiradores de su arma. Pueden mirar el resto con un clic: no se les esconde nada."
        miembros={seleccionadores}
        ocupado={ocupado}
        onEditar={(m) => {
          setBorrador({
            profileId: m.profileId,
            fullName: m.fullName,
            email: m.email,
            role: m.role,
            weapons: m.weapons,
          });
          setError(null);
          setExistente(null);
        }}
        onEjecutar={ejecutar}
        onConfirmar={setConfirmacion}
      />

      <Dialog
        open={confirmacion !== null}
        onOpenChange={(abierto) => !abierto && setConfirmacion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmacion?.accion === 'revocar'
                ? `Revocar el acceso a ${confirmacion.miembro.fullName}`
                : `Quitar a ${confirmacion?.miembro.fullName} del equipo`}
            </DialogTitle>
            <DialogDescription>
              {confirmacion?.accion === 'revocar'
                ? 'Dejará de poder entrar en la aplicación: la pantalla de acceso no le mandará código. Sus datos y su rol se quedan como están y puedes devolverle el acceso cuando quieras.'
                : 'Pierde el panel de gestión y pasa a ser una cuenta normal, pero sigue pudiendo entrar en la aplicación. Su perfil no se borra: haría falta para el historial de cambios y para sus fichas de tirador.'}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={ocupado}
              onClick={() => {
                if (!confirmacion) return;
                const { miembro, accion } = confirmacion;
                setConfirmacion(null);
                void ejecutar(() =>
                  accion === 'revocar'
                    ? revocarAcceso(miembro.profileId)
                    : quitarDelEquipo(miembro.profileId),
                );
              }}
            >
              {ocupado ? <Loader2 className="animate-spin" /> : null}
              {confirmacion?.accion === 'revocar'
                ? 'Revocar el acceso'
                : 'Quitar del equipo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={borrador !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setBorrador(null);
            setError(null);
            setExistente(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {borrador?.profileId ? 'Cambiar el alcance' : 'Dar de alta a alguien'}
            </DialogTitle>
            <DialogDescription>
              {borrador?.profileId
                ? 'Se cambia el rol, las armas y el nombre. El correo no se toca: es su forma de entrar.'
                : 'A partir de que exista el perfil, la persona puede entrar escribiendo su correo en la pantalla de acceso.'}
            </DialogDescription>
          </DialogHeader>

          {borrador ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipo-nombre">Nombre y apellidos</Label>
                <Input
                  id="equipo-nombre"
                  value={borrador.fullName}
                  onChange={(e) =>
                    setBorrador({ ...borrador, fullName: e.target.value })
                  }
                  placeholder="Marta Ruiz Peña"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipo-correo">Correo</Label>
                <Input
                  id="equipo-correo"
                  type="email"
                  inputMode="email"
                  value={borrador.email}
                  disabled={Boolean(borrador.profileId)}
                  onChange={(e) => setBorrador({ ...borrador, email: e.target.value })}
                  placeholder="marta.ruiz@rfee.es"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="equipo-rol">Papel</Label>
                <Select
                  value={borrador.role}
                  onValueChange={(valor) =>
                    setBorrador({
                      ...borrador,
                      role: valor as 'admin' | 'coach',
                      weapons: valor === 'admin' ? [] : borrador.weapons,
                    })
                  }
                >
                  <SelectTrigger id="equipo-rol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coach">Seleccionador de un arma</SelectItem>
                    <SelectItem value="admin">Dirección técnica</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {borrador.role === 'coach' ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-sm font-medium">Armas que lleva</legend>
                  {ARMAS.map((arma) => (
                    <div key={arma} className="flex items-center gap-2.5">
                      <Checkbox
                        id={`arma-${arma}`}
                        checked={borrador.weapons.includes(arma)}
                        onCheckedChange={(valor) =>
                          setBorrador({
                            ...borrador,
                            weapons:
                              valor === true
                                ? [...borrador.weapons, arma]
                                : borrador.weapons.filter((a) => a !== arma),
                          })
                        }
                      />
                      <Label htmlFor={`arma-${arma}`} className="font-normal">
                        {WEAPON_LABEL[arma]}
                      </Label>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Sin ninguna marcada no vería a ningún tirador al entrar.
                  </p>
                </fieldset>
              ) : (
                <p className="medida text-xs text-muted-foreground">
                  La dirección técnica no lleva un arma concreta: su alcance es todo, así
                  que al guardar se le quitan las armas que tuviera.
                </p>
              )}

              {error ? (
                <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                  <p className="medida text-sm text-destructive">{error}</p>
                  {existente ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado}
                      onClick={darAlcanceAlExistente}
                    >
                      Dar este alcance a {existente.fullName}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBorrador(null)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={guardar}>
              {ocupado ? <Loader2 className="animate-spin" /> : null}
              {borrador?.profileId ? 'Guardar el cambio' : 'Dar de alta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BloqueEquipo({
  titulo,
  explicacion,
  miembros,
  ocupado,
  onEditar,
  onEjecutar,
  onConfirmar,
}: {
  titulo: string;
  explicacion: string;
  miembros: MiembroEquipo[];
  ocupado: boolean;
  onEditar: (m: MiembroEquipo) => void;
  onEjecutar: (
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => Promise<void>;
  onConfirmar: (confirmacion: Confirmacion) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg">{titulo}</h2>
        <p className="medida text-sm text-muted-foreground">{explicacion}</p>
      </div>

      {miembros.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Todavía no hay nadie con este papel. Usa «Dar de alta a alguien».
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {miembros.map((m) => (
            <li
              key={m.profileId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3"
            >
              <div className="flex min-w-44 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{m.fullName}</span>
                  {m.weapons.map((arma) => (
                    <Badge key={arma} variant="secondary" className="font-normal">
                      {WEAPON_LABEL[arma]}
                    </Badge>
                  ))}
                  {m.inviteStatus === 'revocada' ? (
                    <Badge variant="destructive" className="font-normal">
                      Acceso revocado
                    </Badge>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{m.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.haEntrado
                    ? 'Ha entrado alguna vez'
                    : 'Todavía no ha entrado ninguna vez'}
                  {` · de alta desde el ${formatDateEs(m.createdAt)}`}
                </span>
              </div>

              {/*
                Lo que se hace a diario va a la vista; lo que quita permisos,
                al menú. Tres botones por fila, dos de ellos irreversibles a
                un clic, es una fila que se pulsa por error.
              */}
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => onEditar(m)}
                >
                  <Pencil /> Cambiar alcance
                </Button>

                {m.inviteStatus === 'revocada' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocupado}
                    onClick={() => onEjecutar(() => restaurarAcceso(m.profileId))}
                  >
                    <KeyRound /> Devolver el acceso
                  </Button>
                ) : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={ocupado}
                      aria-label={`Más acciones sobre ${m.fullName}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {m.inviteStatus !== 'revocada' ? (
                      <DropdownMenuItem
                        onSelect={() => onConfirmar({ miembro: m, accion: 'revocar' })}
                      >
                        <KeyRound /> Revocar el acceso a la aplicación
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => onConfirmar({ miembro: m, accion: 'quitar' })}
                    >
                      <UserMinus /> Quitar del equipo de gestión
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
