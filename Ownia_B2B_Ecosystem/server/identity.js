// Identidad del usuario que hace la request. En GAS sale de la cuenta Google del dominio
// (Session.getActiveUser). En Ownia depende de qué ponga adelante la plataforma, y eso
// todavía no está confirmado (ver CONTEXT.md, "Identidad").
//
// Un header de identidad solo es confiable si el proxy de adelante SIEMPRE lo pisa; si no,
// cualquiera lo manda a mano. Por eso solo se usa el header configurado en
// APP_SECRETS.TRUSTED_IDENTITY_HEADER. Sin esa config, Session.getActiveUser() devuelve ''
// (como un usuario anónimo) y /whoami solo informa qué headers candidatos llegan.

const CANDIDATE_HEADERS = [
  'cf-access-authenticated-user-email', // Cloudflare Access
  'x-amzn-oidc-data', // ALB de AWS con OIDC (JWT)
  'x-auth-request-email', // oauth2-proxy
  'x-forwarded-email',
  'x-goog-authenticated-user-email', // Google IAP ("accounts.google.com:mail@...")
  'x-ms-client-principal-name',
  'x-user-email',
  'remote-user',
];

function emailFromJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return json.email || null;
  } catch (e) {
    return null;
  }
}

function emailFromHeader(name, value) {
  if (!value) return '';
  const raw = name === 'x-amzn-oidc-data' ? emailFromJwt(String(value)) : String(value);
  const email = String(raw || '').replace(/^accounts\.google\.com:/, '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}

// Mismo alcance que `access: DOMAIN` en GAS.
const ALLOWED_DOMAIN = '@despegar.com';

// x-amzn-oidc-data es un JWT que habría que verificar (firma ES256 del ALB, signer, exp)
// antes de confiar en él; hasta implementarlo no se acepta como header confiable.
const UNVERIFIED_JWT_HEADERS = new Set(['x-amzn-oidc-data']);

function resolveIdentity(headers, trustedHeader) {
  const h = String(trustedHeader || '').toLowerCase();
  if (!h || UNVERIFIED_JWT_HEADERS.has(h)) return { email: '', source: null };
  const email = emailFromHeader(h, headers[h]);
  return email && email.endsWith(ALLOWED_DOMAIN) ? { email, source: h } : { email: '', source: null };
}

// Para /whoami: qué headers de autenticación llegan (nombre + si traen un email válido).
// No se devuelven tokens.
function describeAuthHeaders(headers) {
  const seen = Object.keys(headers).filter(
    (k) => CANDIDATE_HEADERS.includes(k) || /auth|email|oidc|identity|cf-access|principal|jwt/i.test(k)
  );
  return seen.sort().map((k) => {
    const email = emailFromHeader(k, headers[k]);
    return { header: k, email: email || null };
  });
}

module.exports = { resolveIdentity, describeAuthHeaders, CANDIDATE_HEADERS, ALLOWED_DOMAIN };
