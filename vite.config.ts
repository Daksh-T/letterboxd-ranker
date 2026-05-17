import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
  server: {
    proxy: {
      "/api/lb": {
        target: "https://letterboxd.com",
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          return url.searchParams.get("path") ?? "/";
        },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      },
    },
  },
});
