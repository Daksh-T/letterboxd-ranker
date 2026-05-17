const LETTERBOXD_ORIGIN = "https://letterboxd.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function makeReferer(path) {
  const pageMatch = path.match(/^\/([^/]+)\/films\/page\/\d+\//);
  if (pageMatch) return `${LETTERBOXD_ORIGIN}/${pageMatch[1]}/films/`;
  return LETTERBOXD_ORIGIN;
}

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, `https://${request.headers.host ?? "localhost"}`);
  const rawPath = requestUrl.searchParams.get("path") ?? "";
  const targetPath = `/${rawPath.replace(/^\/+/, "")}`;
  const targetUrl = new URL(targetPath, LETTERBOXD_ORIGIN);

  const upstream = await fetch(targetUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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
  });

  const body = await upstream.text();
  response.status(upstream.status);
  response.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  response.send(body);
}
