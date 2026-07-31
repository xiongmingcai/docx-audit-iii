/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_URL?: string;
  readonly VITE_WORKER_NAME?: string;
  readonly VITE_DEFAULT_PROJECT?: string;
  readonly VITE_DATA_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
