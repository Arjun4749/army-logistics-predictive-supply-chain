import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/army-logistics-predictive-supply-chain/",
  plugins: [react()],
  server: { host: "0.0.0.0" }
});
