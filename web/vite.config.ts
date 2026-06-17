import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 모드에서는 /ws 를 Rust 서버(8080)로 프록시한다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
