/** No passwords, including local development: only verified invited email OTP. */
export function accesoConContrasena(): boolean {
  return false;
}

export function esRolAplicacion(role: string): role is 'admin' | 'coach' | 'athlete' {
  return role === 'admin' || role === 'coach' || role === 'athlete';
}

/** Un correo sin verificar nunca puede reclamar una invitación por email. */
export function correoVerificado(user: { emailVerified?: boolean }): boolean {
  return user.emailVerified === true;
}
