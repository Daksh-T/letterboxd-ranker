import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = process.argv[2] ?? "majorpanicx";
const BASE_URL = `https://letterboxd.com/${USERNAME}/films`;
const OUT_FILE = "src/data/movies.ts";

type Movie = {
  id: string;
  title: string;
  year: number | null;
  slug: string;
  letterboxdUrl: string;
  posterUrl: string | null;
};

const decodeHtml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&ndash;", "-")
    .replaceAll("&mdash;", "-")
    .replaceAll("&bull;", "•")
    .replaceAll("&lrm;", "")
    .replaceAll("&nbsp;", " ");

const stripYear = (name: string) => {
  const match = name.match(/\s\((\d{4})\)$/);
  return {
    title: match ? name.slice(0, match.index).trim() : name.trim(),
    year: match ? Number(match[1]) : null,
  };
};

const fetchText = async (url: string) => {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (response.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 800 + attempt * 1200));
  }

  if (!response?.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

const getMaxPage = (html: string) => {
  const pages = [...html.matchAll(/\/films\/page\/(\d+)\//g)].map((match) =>
    Number(match[1]),
  );
  return Math.max(1, ...pages);
};

const parseMovies = (html: string) => {
  const movies: Movie[] = [];
  const seen = new Set<string>();
  const pattern =
    /data-item-name="([^"]+)"[\s\S]*?data-item-slug="([^"]+)"[\s\S]*?data-item-link="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    const fullName = decodeHtml(match[1]);
    const { title, year } = stripYear(fullName);
    const slug = decodeHtml(match[2]);
    const link = decodeHtml(match[3]);
    const id = slug;

    if (seen.has(id)) continue;
    seen.add(id);

    movies.push({
      id,
      title,
      year,
      slug,
      letterboxdUrl: `https://letterboxd.com${link}`,
      posterUrl: null,
    });
  }

  return movies;
};

const parseRssPosters = (rss: string, username: string) => {
  const posters = new Map<string, string>();
  const itemPattern = /<item>[\s\S]*?<\/item>/g;

  for (const itemMatch of rss.matchAll(itemPattern)) {
    const item = itemMatch[0];
    const link = item.match(new RegExp(`<link>https://letterboxd\\.com/${username}/film/([^/]+)/(?:\\\\d+/)?</link>`));
    const image = item.match(/<img src="([^"]+)"/);
    if (!link || !image) continue;
    posters.set(decodeHtml(link[1]), decodeHtml(image[1]));
  }

  return posters;
};

const parseStructuredPoster = (html: string) => {
  const imageMatch = html.match(/"image":"([^"]+-0-\d+-0-\d+-crop\.jpg\?v=[^"]+)"/);
  return imageMatch ? decodeHtml(imageMatch[1].replaceAll("\\/", "/")) : null;
};

const backfillPoster = async (movie: Movie) => {
  if (movie.posterUrl) return movie;

  try {
    const html = await fetchText(movie.letterboxdUrl);
    return {
      ...movie,
      posterUrl: parseStructuredPoster(html),
    };
  } catch {
    return movie;
  }
};

const main = async () => {
  const firstPage = await fetchText(`${BASE_URL}/`);
  const pageCount = getMaxPage(firstPage);
  const pageUrls = Array.from({ length: pageCount }, (_, index) =>
    index === 0 ? `${BASE_URL}/` : `${BASE_URL}/page/${index + 1}/`,
  );

  const pages = [firstPage];
  for (const url of pageUrls.slice(1)) {
    pages.push(await fetchText(url));
  }
  const rss = await fetchText(`https://letterboxd.com/${USERNAME}/rss/`);
  const rssPosters = parseRssPosters(rss, USERNAME);

  const byId = new Map<string, Movie>();
  for (const page of pages) {
    for (const movie of parseMovies(page)) {
      if (!byId.has(movie.id)) byId.set(movie.id, movie);
    }
  }

  const moviesWithoutBackfill = [...byId.values()]
    .map((movie) => ({
      ...movie,
      posterUrl: rssPosters.get(movie.slug) ?? null,
    }))
    .sort((a, b) => {
      if (a.year === b.year) return a.title.localeCompare(b.title);
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });

  const movies = [];
  const batchSize = 8;
  for (let index = 0; index < moviesWithoutBackfill.length; index += batchSize) {
    const batch = moviesWithoutBackfill.slice(index, index + batchSize);
    movies.push(...(await Promise.all(batch.map(backfillPoster))));
  }

  const matchedPosters = movies.filter((movie) => movie.posterUrl).length;

  await mkdir("src/data", { recursive: true });
  await writeFile(
    OUT_FILE,
    `export type Movie = {
  id: string;
  title: string;
  year: number | null;
  slug: string;
  letterboxdUrl: string;
  posterUrl: string | null;
};

export const movies: Movie[] = ${JSON.stringify(movies, null, 2)};
`,
  );

  console.log(`Wrote ${movies.length} movies from ${pageCount} Letterboxd pages to ${OUT_FILE}`);
  console.log(`Matched ${matchedPosters} poster/artwork URLs (${rssPosters.size} from RSS)`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
