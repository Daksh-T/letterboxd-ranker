import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
  server: {
    proxy: {
      "/lb": {
        target: "https://letterboxd.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lb/, ""),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        },
      },
    },
  },
});
