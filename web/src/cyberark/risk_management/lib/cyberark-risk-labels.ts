/* Spanish presentation of observed CyberArk catalog literals. Unknown values
   remain verbatim; source payloads and technical references are unchanged. */
const STATUS_LABELS: Record<string, string> = { open: 'Abierto' };
const SEVERITY_LABELS: Record<string, string> = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };

function labelFor(labels: Record<string, string>, value: string | null, emptyLabel: string): { label: string; known: boolean } {
  const literal = value || '';
  if (!literal) return { label: emptyLabel, known: false };
  const label = labels[literal.trim().toLowerCase()];
  return label ? { label, known: true } : { label: literal, known: false };
}

export function cyberarkStatusLabel(status: string | null): { label: string; known: boolean } {
  return labelFor(STATUS_LABELS, status, 'Sin dato');
}

export function cyberarkSeverityLabel(severity: string | null): { label: string; known: boolean } {
  return labelFor(SEVERITY_LABELS, severity, 'Sin dato');
}

export function cyberarkStatusTone(status: string | null): 'danger' | 'neutral' {
  return (status || '').trim().toLowerCase() === 'open' ? 'danger' : 'neutral';
}

// Exact source texts: a revised description must never reuse an outdated translation.
const RISK_NAMES: Record<string, string> = {
  "User without assigned access policy": "Usuario sin política de acceso asignada",
  "User with aged password": "Usuario con contraseña sin actualizar",
  "Service account with aged credentials": "Cuenta de servicio con credenciales sin actualizar",
  "OIDC Broad Redirect URIs": "URI de redirección OIDC demasiado amplias",
  "Weak authentication assurance level or password policy": "Nivel de garantía de autenticación o política de contraseñas débiles",
  "Compromised user password": "Contraseña de usuario comprometida",
  "Enable token rotation": "Habilitar la rotación de tokens",
  "Disabled SAML Encryption": "Cifrado SAML deshabilitado",
  "Excessive Refresh Token Lifetime": "Vigencia excesiva de los tokens de actualización",
  "SAML Single logout not configured": "Cierre de sesión único SAML sin configurar",
  "Dormant user account": "Cuenta de usuario inactiva",
  "Excessive Token Lifetime": "Vigencia excesiva de los tokens",
  "SAML Single logout weakly configured": "Configuración débil del cierre de sesión único SAML",
  "Unused App access": "Acceso a aplicación sin uso"
};

// Exact source texts: a revised description must never reuse an outdated translation.
const RISK_DESCRIPTIONS: Record<string, string> = {
  "The user does not have any active access policy assigned. This may result in unmanaged or overly broad access.": "El usuario no tiene ninguna política de acceso activa asignada. Esto puede dar lugar a accesos sin gestionar o demasiado amplios.",
  "The user account has a password that has not been changed in over 30 days, increasing the risk of unauthorized access and credential compromise.": "La contraseña de la cuenta de usuario no se ha cambiado en más de 30 días, lo que aumenta el riesgo de acceso no autorizado y de que las credenciales se vean comprometidas.",
  "The service account password has not changed for more than 30 days. Long-lived credentials increase the risk of compromise and lateral movement.": "La contraseña de la cuenta de servicio no se ha cambiado en más de 30 días. Las credenciales de larga duración aumentan el riesgo de que se vean comprometidas y de movimiento lateral.",
  "Identifies unencrypted redirect URIs or broad wildcards.": "Identifica URI de redirección sin cifrar o con comodines demasiado amplios.",
  "The user is assigned a role with a minimum authentication assurance level (AAL) set to AAL1 or unknown. Weak assurance levels and password policies increase the risk of unauthorized access.": "El usuario tiene asignado un rol cuyo nivel mínimo de garantía de autenticación (AAL) es AAL1 o desconocido. Los niveles de garantía y las políticas de contraseñas débiles aumentan el riesgo de acceso no autorizado.",
  "The user account has a password identified as compromised. This increases the risk of unauthorized access and account takeover.": "La cuenta de usuario tiene una contraseña identificada como comprometida. Esto aumenta el riesgo de acceso no autorizado y de toma de control de la cuenta.",
  "Detects apps where refresh token rotation is disabled.": "Detecta aplicaciones en las que la rotación de tokens de actualización está deshabilitada.",
  "The SAML application has encryption disabled for SAML assertions, increasing the risk of man-in-the-middle attacks and exposure of sensitive authentication data.": "La aplicación SAML tiene deshabilitado el cifrado de las aserciones SAML, lo que aumenta el riesgo de ataques de intermediario y de exposición de datos sensibles de autenticación.",
  "The OIDC/OAuth application has refresh token lifetimes exceeding recommended security thresholds, increasing the risk window for token exploitation and unauthorized access.": "La aplicación OIDC/OAuth tiene tokens de actualización cuya vigencia supera los límites de seguridad recomendados, lo que amplía el período en el que pueden explotarse para obtener acceso no autorizado.",
  "Identifies blank SLO URLs or missing SHA256 signing.": "Identifica URL de cierre de sesión único (SLO) vacías o ausencia de firma SHA256.",
  "The user account has not logged in for more than 60 days. Dormant accounts increase the attack surface and may indicate unused or unmanaged access.": "La cuenta de usuario no ha iniciado sesión en más de 60 días. Las cuentas inactivas aumentan la superficie de ataque y pueden indicar accesos sin uso o sin gestionar.",
  "The OIDC/OAuth application has token lifetimes exceeding recommended security thresholds, increasing the risk window for token exploitation and unauthorized access.": "La aplicación OIDC/OAuth tiene tokens cuya vigencia supera los límites de seguridad recomendados, lo que amplía el período en el que pueden explotarse para obtener acceso no autorizado.",
  "The application has not been launched in more than 30 days, indicating potential unused access that increases the attack surface and may violate least privilege principles.": "La aplicación no se ha abierto en más de 30 días. Esto puede indicar accesos sin uso que aumentan la superficie de ataque y pueden incumplir el principio de mínimo privilegio."
};

export function cyberarkRiskName(name: string): string {
  return Object.hasOwn(RISK_NAMES, name) ? RISK_NAMES[name] : name;
}

export function cyberarkRiskDescription(description: string | null): string | null {
  return description && Object.hasOwn(RISK_DESCRIPTIONS, description) ? RISK_DESCRIPTIONS[description] : description;
}

export function cyberarkEntityLabel(entity: string | null): string {
  return labelFor({ user: 'Usuario', webapp: 'Aplicación web' }, entity, 'Sin dato').label;
}
