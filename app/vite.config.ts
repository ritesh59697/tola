import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE is the path the site is served under, for example /tola/ on GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
