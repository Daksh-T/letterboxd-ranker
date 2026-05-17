export const config = {
  runtime: "edge",
};

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

export default async function handler(request, response) {
  const requestUrl = new URL(request.url);
  const rawPath = requestUrl.searchParams.get("path") ?? "";
  const targetPath = `/${rawPath.replace(/^\/+/, "")}`;
  const targetUrl = new URL(targetPath, LETTERBOXD_ORIGIN);

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        Referer: makeReferer(targetPath),
      },
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response("Could not fetch Letterboxd.", { status: 502 });
  }
}
