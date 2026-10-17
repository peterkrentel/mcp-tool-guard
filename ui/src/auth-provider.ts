export type IdpProviderId = "auth0" | "entra";

export function normalizeIdpProvider(raw: string | undefined): IdpProviderId {
  const value = raw?.trim().toLowerCase();
  if (!value) return "auth0";
  if (value === "auth0" || value === "entra") return value;
  throw new Error(`Unrecognized VITE_IDP_PROVIDER '${raw}' — expected 'auth0' or 'entra'`);
}
