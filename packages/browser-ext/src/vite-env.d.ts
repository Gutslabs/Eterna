/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_HOST?: string;
  readonly VITE_AI_TOKEN?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_DEV_MODE?: string;
  /** Base URL for the website (e.g., "https://www.claudechrome.com") */
  readonly VITE_WEBSITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Support for CSS imports with ?inline suffix
declare module "*.css?inline" {
  const content: string;
  export default content;
}

// Support for raw text imports (e.g. agent skill markdown)
declare module "*?raw" {
  const content: string;
  export default content;
}
