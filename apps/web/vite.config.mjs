import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Prefer IPv4 — proxying to "localhost" can hang on Windows when ::1
        // is tried first while the API is only listening on 0.0.0.0.
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
