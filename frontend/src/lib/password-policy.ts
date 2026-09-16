const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%&*_-',
] as const;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function passwordChecks(password: string): boolean[] {
  const length = Array.from(password).length;
  return [length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH, /[0-9]/u.test(password), /[\p{P}\p{S}]/u.test(password)];
}

export function passwordRequirements(password: string) {
  const labels = [`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`, 'Al menos un número (0–9)', 'Al menos un símbolo (por ejemplo !, @, #)'];
  return passwordChecks(password).map((valid, index) => ({ label: labels[index], valid }));
}

function randomIndex(limit: number): number {
  const bytes = new Uint32Array(1);
  const cutoff = 2 ** 32 - (2 ** 32 % limit);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= cutoff);
  return bytes[0] % limit;
}

export function generatePassword(): string {
  const allCharacters = PASSWORD_GROUPS.join('');
  const characters = PASSWORD_GROUPS.map((group) => group[randomIndex(group.length)]);
  while (characters.length < MIN_PASSWORD_LENGTH) characters.push(allCharacters[randomIndex(allCharacters.length)]);
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join('');
}

export function passwordFeedback(password: string, confirmation: string) {
  const length = Array.from(password).length;
  const checks = passwordChecks(password);
  return {
    valid: checks.every(Boolean),
    remaining: Math.max(0, MIN_PASSWORD_LENGTH - length),
    progress: checks.filter(Boolean).length / checks.length * 100,
    matches: password.length > 0 && password === confirmation,
  };
}
