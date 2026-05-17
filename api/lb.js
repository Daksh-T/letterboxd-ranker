const LETTERBOXD_ORIGIN = "https://letterboxd.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, `https://${request.headers.host ?? "localhost"}`);
  const rawPath = requestUrl.searchParams.get("path") ?? "";
  const targetPath = `/${rawPath.replace(/^\/+/, "")}`;
  const targetUrl = new URL(targetPath, LETTERBOXD_ORIGIN);

  const upstream = await fetch(targetUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const body = await upstream.text();
  response.status(upstream.status);
  response.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  response.send(body);
}
