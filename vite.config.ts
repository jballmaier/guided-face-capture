import { defineConfig } from "vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * Copies the licence notices into the build.
 *
 * Both Apache 2.0 and MIT require the notices to travel with the distribution,
 * and the distribution is `dist/` - not the repository. Without this, anyone
 * self-hosting the built page would pass on MediaPipe and fflate without them.
 */
function licenceNotices(): Plugin {
  return {
    name: "licence-notices",
    apply: "build",
    closeBundle() {
      const out = resolve(__dirname, "dist");
      cpSync(resolve(__dirname, "THIRD-PARTY-NOTICES.md"), resolve(out, "THIRD-PARTY-NOTICES.md"));
      cpSync(resolve(__dirname, "licenses"), resolve(out, "licenses"), { recursive: true });
      cpSync(resolve(__dirname, "LICENSE"), resolve(out, "LICENSE"));
    },
  };
}

/**
 * HTTPS is opt-in via the mode: `npm run dev` locally, `npm run dev:lan` for
 * testing on a phone.
 *
 * getUserMedia needs a secure context. localhost counts as one over plain
 * HTTP, so the certificate is only needed for LAN access. A mode rather than
 * an environment variable, because `HTTPS=1 vite` does not work in PowerShell.
 */
export default defineConfig(({ mode }) => ({
  /**
   * Relative paths, not absolute.
   *
   * GitHub Pages serves a project from a subpath, not from the root. With `/`
   * as the base the page would look for its assets one level too high and stay
   * blank. `./` covers both and survives a rename of the project. The MediaPipe
   * files follow via `import.meta.env.BASE_URL`.
   */
  base: "./",
  plugins: mode === "lan" ? [basicSsl(), licenceNotices()] : [licenceNotices()],
  server: {
    host: true, // im LAN erreichbar, sonst kein Test auf dem Smartphone
    port: 5173,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      // Beide Seiten muessen hier stehen: sobald `input` gesetzt ist, findet
      // Vite index.html nicht mehr von allein.
      input: {
        main: resolve(__dirname, "index.html"),
        basic: resolve(__dirname, "basic.html"),
      },
    },
  },
  optimizeDeps: {
    // tasks-vision is pre-bundled on purpose. Excluded, Vite serves the file
    // raw and trips on its sourceMappingURL, for which the package ships no
    // map - a harmless message that looks like an error. The WASM files
    // are unaffected: they live under public/ and are loaded at runtime via
    // basePath, not imported.
    include: ["@mediapipe/tasks-vision"],
  },
}));
