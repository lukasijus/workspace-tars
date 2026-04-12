import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load env file from the workspace root
  const env = loadEnv(mode, "../../", "TARS_LIFECYCLE_");
  const port = parseInt(env.TARS_LIFECYCLE_DASHBOARD_PORT || "4310", 10);

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: port,
      proxy: {
        "/api": `http://127.0.0.1:${port}`,
        "/artifacts": `http://127.0.0.1:${port}`,
      },
    },
  };
});
