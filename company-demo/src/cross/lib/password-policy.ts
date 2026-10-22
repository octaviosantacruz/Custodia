const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%&*_-',
] as const;
export const MIN_PASSWORD_LENGTH = 15;

export function passwordChecks(password: string): boolean[] {
  return [password.length >= MIN_PASSWORD_LENGTH];
}

export function passwordRequirements(password: string) {
  return passwordChecks(password).map((valid) => ({
    label: `${MIN_PASSWORD_LENGTH} caracteres`,
    valid,
  }));
}

export function generatePassword(): string {
  const bytes = new Uint32Array(MIN_PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  const allCharacters = PASSWORD_GROUPS.join('');
  return Array.from(bytes, (byte) => allCharacters[byte % allCharacters.length]).join('');
}
