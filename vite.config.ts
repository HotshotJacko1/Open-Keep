import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// Read version from build.gradle
const buildGradlePath = path.resolve(__dirname, 'android/app/build.gradle');
let appVersion = 'Unknown';
try {
  if (fs.existsSync(buildGradlePath)) {
    const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    const versionMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
    if (versionMatch && versionMatch[1]) {
      appVersion = versionMatch[1];
    }
  }
} catch (e) {
  console.error('Failed to parse build.gradle for version', e);
}

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
