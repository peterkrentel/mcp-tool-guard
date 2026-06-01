/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MCP_URL?: string;
  readonly VITE_AUTH0_DOMAIN?: string;
  readonly VITE_AUTH0_CLIENT_ID?: string;
  readonly VITE_AUTH0_AUDIENCE?: string;
  readonly VITE_ENABLE_GUEST_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
