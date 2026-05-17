import https from "node:https";
import zlib from "node:zlib";

const LETTERBOXD_ORIGIN = "https://letterboxd.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function makeReferer(path) {
  const pageMatch = path.match(/^\/([^/]+)\/films\/page\/(\d+)\//);
  if (pageMatch) {
    const previousPage = Number(pageMatch[2]) - 1;
    if (previousPage > 1) return `${LETTERBOXD_ORIGIN}/${pageMatch[1]}/films/page/${previousPage}/`;
    return `${LETTERBOXD_ORIGIN}/${pageMatch[1]}/films/`;
  }
  return LETTERBOXD_ORIGIN;
}

function decodeBody(buffer, encoding) {
  if (encoding?.includes("br")) return zlib.brotliDecompressSync(buffer);
  if (encoding?.includes("gzip")) return zlib.gunzipSync(buffer);
  if (encoding?.includes("deflate")) return zlib.inflateSync(buffer);
  return buffer;
}

function fetchLetterboxd(targetUrl, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      targetUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "max-age=0",
          Referer: makeReferer(targetPath),
          "Sec-Ch-Ua": '"Chromium";v="125", "Not.A/Brand";v="24"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"macOS"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      },
      (upstream) => {
        const chunks = [];
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          try {
            const body = decodeBody(Buffer.concat(chunks), upstream.headers["content-encoding"]);
            resolve({
              statusCode: upstream.statusCode ?? 500,
              contentType: upstream.headers["content-type"] ?? "text/plain; charset=utf-8",
              body,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function makeJinaUrl(targetPath) {
  return new URL(`https://r.jina.ai/http://http://letterboxd.com${targetPath}`);
}

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, `https://${request.headers.host ?? "localhost"}`);
  const rawPath = requestUrl.searchParams.get("path") ?? "";
  const targetPath = `/${rawPath.replace(/^\/+/, "")}`;
  const targetUrl = new URL(targetPath, LETTERBOXD_ORIGIN);

  try {
    let upstream = await fetchLetterboxd(targetUrl, targetPath);
    if (upstream.statusCode === 403) {
      upstream = await fetchLetterboxd(makeJinaUrl(targetPath), targetPath);
    }
    response.status(upstream.statusCode);
    response.setHeader("Content-Type", upstream.contentType);
    response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    response.send(upstream.body);
  } catch {
    response.status(502).send("Could not fetch Letterboxd.");
  }
}
