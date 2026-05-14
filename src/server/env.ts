import { loadEnv } from "vite";

export function loadLocalEnv(): void {
  const mode = process.env.NODE_ENV ?? "development";
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
}
