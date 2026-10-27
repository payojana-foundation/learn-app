/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Build identity injected by Vite `define` (see vite.config.ts). The short
 * build hash and the build date are compile-time constants; they feed the
 * version label shown in the app shell.
 */
declare const __BUILD_HASH__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  readonly VITE_MEDIA_BASE_URL?: string;
  readonly VITE_VACANA_BASE_URL?: string;
  readonly VITE_LIBRARY_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
