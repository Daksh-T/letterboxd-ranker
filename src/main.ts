import { movies as defaultMovies, type Movie } from "./data/movies";
import "./styles.css";

type Pair = [string, string];
type Rating = {
  id: string;
  score: number;
  seen: number;
};
type VoteRecord = {
  pair: Pair;
  previousRatings: Record<string, Rating>;
};
type State = {
  ratings: Record<string, Rating>;
  currentPair: Pair | null;
  comparisons: Record<string, number>;
  history: VoteRecord[];
  importedChoices: number;
  importedUniquePairs: number;
  skipped: number;
  startedAt: string;
};
type Backup = {
  version: 4;
  username: string;
  movies: Movie[];
  state: State;
};

const BASE_SCORE = 1500;
const K_FACTOR = 32;
const DEFAULT_USERNAME = "majorpanicx";
const initialCoverageTarget = 4;
const INTRO_KEY = "letterboxd-ranker-intro-seen-v1";

let username = localStorage.getItem("letterboxd-ranker-username") ?? "";
let movies: Movie[] = username ? loadCachedMovies(username) ?? (username === DEFAULT_USERNAME ? defaultMovies : []) : [];
let movieById = new Map(movies.map((movie) => [movie.id, movie]));
let state = loadState();

const $ = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

function storageKey(name = username) {
  return `letterboxd-ranker-state-v4:${name}:${movies.map((movie) => movie.id).join("|")}`;
}

function moviesCacheKey(name: string) {
  return `letterboxd-ranker-movies-v2:${name}`;
}

function totalPairs() {
  return (movies.length * (movies.length - 1)) / 2;
}

function revealThreshold() {
  if (movies.length < 2) return 0;
  return Math.min(totalPairs(), Math.max(40, movies.length * 2));
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function decodeHtml(value: string) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function stripYear(name: string) {
  const match = name.match(/\s\((\d{4})\)$/);
  return {
    title: match ? name.slice(0, match.index).trim() : name.trim(),
    year: match ? Number(match[1]) : null,
  };
}

function makeRatings() {
  return Object.fromEntries(
    movies.map((movie) => [
      movie.id,
      {
        id: movie.id,
        score: BASE_SCORE,
        seen: 0,
      },
    ]),
  );
}

function makeInitialState(): State {
  const ratings = makeRatings();
  return {
    ratings,
    currentPair: movies.length >= 2 ? selectNextPair(ratings, {}, 0, null) : null,
    comparisons: {},
    history: [],
    importedChoices: 0,
    importedUniquePairs: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
  };
}

function loadCachedMovies(name: string) {
  try {
    const raw = localStorage.getItem(moviesCacheKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Movie[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function saveMovies(name: string, nextMovies: Movie[]) {
  localStorage.setItem(moviesCacheKey(name), JSON.stringify(nextMovies));
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return makeInitialState();
    const parsed = JSON.parse(raw) as State;
    if (!parsed.currentPair || Object.keys(parsed.ratings ?? {}).length !== movies.length) {
      return makeInitialState();
    }
    return parsed;
  } catch {
    return makeInitialState();
  }
}

function saveState() {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  localStorage.setItem("letterboxd-ranker-username", username);
}

function resetCurrentPair() {
  state.currentPair = movies.length >= 2 ? selectNextPair(state.ratings, state.comparisons, choicesMade(), null) : null;
}

function choicesMade() {
  return (state.importedChoices ?? 0) + state.history.length;
}

function uniquePairsCompared() {
  return (state.importedUniquePairs ?? 0) + Object.keys(state.comparisons).length;
}

function cloneRatings(ids: string[], ratings = state.ratings) {
  return Object.fromEntries(ids.map((id) => [id, { ...ratings[id] }]));
}

function pairKey(pair: Pair) {
  return [...pair].sort().join("::");
}

function updateElo(winner: Rating, loser: Rating, draw = false) {
  const expectedWinner = 1 / (1 + 10 ** ((loser.score - winner.score) / 400));
  const expectedLoser = 1 / (1 + 10 ** ((winner.score - loser.score) / 400));
  const winnerResult = draw ? 0.5 : 1;
  const loserResult = draw ? 0.5 : 0;

  return {
    winner: {
      ...winner,
      score: winner.score + K_FACTOR * (winnerResult - expectedWinner),
      seen: winner.seen + 1,
    },
    loser: {
      ...loser,
      score: loser.score + K_FACTOR * (loserResult - expectedLoser),
      seen: loser.seen + 1,
    },
  };
}

function rankMovies() {
  return movies
    .map((movie) => ({ movie, rating: state.ratings[movie.id] }))
    .sort((a, b) => b.rating.score - a.rating.score || b.rating.seen - a.rating.seen);
}

function currentMovies() {
  const pair = state.currentPair;
  if (!pair) return null;
  const left = movieById.get(pair[0]);
  const right = movieById.get(pair[1]);
  if (!left || !right) return null;
  return { pair, left, right };
}

function selectNextPair(
  ratings: Record<string, Rating>,
  comparisons: Record<string, number>,
  answered: number,
  previousPair: Pair | null,
): Pair {
  const random = mulberry32(hashSeed(`${username}-refine-${answered}`));
  const inCoverage = Object.values(ratings).some((rating) => rating.seen < initialCoverageTarget);
  const candidates: { pair: Pair; score: number }[] = [];

  for (let left = 0; left < movies.length; left += 1) {
    for (let right = left + 1; right < movies.length; right += 1) {
      const leftId = movies[left].id;
      const rightId = movies[right].id;
      const pair: Pair = [leftId, rightId];
      const key = pairKey(pair);
      const count = comparisons[key] ?? 0;
      const leftRating = ratings[leftId];
      const rightRating = ratings[rightId];
      const scoreDiff = Math.abs(leftRating.score - rightRating.score);
      const closeness = 1 / (1 + scoreDiff / 120);
      const pairFreshness = 1 / (1 + count);
      const lowSeen = 1 / (1 + Math.min(leftRating.seen, rightRating.seen));
      const coverageNeed =
        Number(leftRating.seen < initialCoverageTarget) + Number(rightRating.seen < initialCoverageTarget);
      const previousPenalty = previousPair && pairKey(previousPair) === key ? 4 : 0;
      const repeatPenalty = count * 0.18;
      const score = inCoverage
        ? coverageNeed * 8 + lowSeen * 3 + pairFreshness * 2 + random() * 0.25 - previousPenalty
        : closeness * 5 + pairFreshness * 2 + lowSeen * 0.7 + random() * 0.5 - repeatPenalty - previousPenalty;

      candidates.push({ pair, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, inCoverage ? 40 : 90);
  return pool[Math.floor(random() * pool.length)].pair;
}

function vote(winnerId: string, loserId: string, draw = false) {
  const pair = state.currentPair;
  if (!pair) return;

  state.history.push({
    pair,
    previousRatings: cloneRatings(pair),
  });

  const updated = updateElo(state.ratings[winnerId], state.ratings[loserId], draw);
  state.ratings[winnerId] = updated.winner;
  state.ratings[loserId] = updated.loser;
  state.comparisons[pairKey(pair)] = (state.comparisons[pairKey(pair)] ?? 0) + 1;
  state.currentPair = selectNextPair(state.ratings, state.comparisons, choicesMade(), pair);

  saveState();
  render();
}

function skipPair() {
  state.skipped += 1;
  state.currentPair = selectNextPair(state.ratings, state.comparisons, choicesMade() + state.skipped, state.currentPair);
  saveState();
  render();
}

function undo() {
  const last = state.history.pop();
  if (!last) return;
  state.ratings = { ...state.ratings, ...last.previousRatings };
  const key = pairKey(last.pair);
  state.comparisons[key] = Math.max(0, (state.comparisons[key] ?? 1) - 1);
  if (state.comparisons[key] === 0) delete state.comparisons[key];
  state.currentPair = last.pair;
  saveState();
  render();
}

function reset() {
  if (!confirm("Reset all choices for this account?")) return;
  state = makeInitialState();
  saveState();
  render();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(title: string) {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

function posterHtml(movie: Movie) {
  if (!movie.posterUrl) return `<div class="poster-fallback">${escapeHtml(initials(movie.title))}</div>`;
  const fallback = escapeHtml(initials(movie.title));
  return `<img src="${movie.posterUrl}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: 'poster-fallback', textContent: '${fallback}'}))">`;
}

function renderMovieCard(target: HTMLElement, movie: Movie, side: "left" | "right") {
  const rating = state.ratings[movie.id];
  target.innerHTML = `
    <a class="choice-poster" href="${movie.letterboxdUrl}" target="_blank" rel="noreferrer" title="Open ${escapeHtml(movie.title)} on Letterboxd">${posterHtml(movie)}</a>
    <div class="choice-info">
      <div class="choice-kicker">${movie.year ?? "Unknown year"}</div>
      <h2><a href="${movie.letterboxdUrl}" target="_blank" rel="noreferrer">${escapeHtml(movie.title)}</a></h2>
      <table class="mini-stats">
        <tr><th>Yellow score</th><td>${Math.round(rating.score)}</td></tr>
        <tr><th>Compared</th><td>${rating.seen}</td></tr>
      </table>
      <button class="choose choose-${side}" type="button">Prefer this</button>
    </div>
  `;
}

function renderLeaderboard() {
  const answered = choicesMade();
  const locked = answered < revealThreshold();
  const rows = rankMovies()
    .slice(0, locked ? 12 : 60)
    .map(({ movie, rating }, index) => {
      const title = locked
        ? "Hidden until reveal"
        : `<a href="${movie.letterboxdUrl}" target="_blank" rel="noreferrer">${escapeHtml(movie.title)}</a>`;
      const year = locked ? "" : movie.year ?? "";
      const score = locked ? "---" : Math.round(rating.score);
      return `
        <tr class="${locked ? "locked-row" : ""}">
          <td class="rank">${index + 1}</td>
          <td>${title}</td>
          <td>${year}</td>
          <td>${score}</td>
          <td>${locked ? "---" : rating.seen}</td>
        </tr>
      `;
    })
    .join("");

  $("#leaderboard-note").textContent = locked
    ? `${revealThreshold() - answered} more choices before the leaderboard unlocks.`
    : "Keep going for a more accurate table";

  $("#leaderboard-body").innerHTML = rows;
}

function csvCell(value: string | number | null) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportLeaderboardCsv() {
  const rows = rankMovies().map(({ movie, rating }, index) => [
    index + 1,
    movie.title,
    movie.year ?? "",
    Math.round(rating.score),
    rating.seen,
    movie.letterboxdUrl,
  ]);
  const csv = [
    ["Rank", "Movie", "Year", "Score", "Compared", "Letterboxd URL"],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${username || "letterboxd"}-leaderboard.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  const payload: Backup = {
    version: 4,
    username,
    movies,
    state,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${username}-movie-ranker-backup.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function restoreJson(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as Backup;
      if (!parsed.username || !Array.isArray(parsed.movies) || !parsed.movies.length || !parsed.state?.ratings) {
        throw new Error("Invalid backup file");
      }
      username = parsed.username;
      movies = parsed.movies;
      movieById = new Map(movies.map((movie) => [movie.id, movie]));
      saveMovies(username, movies);
      state = parsed.state;
      resetCurrentPair();
      saveState();
      render();
      closeBackupDialog();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not restore backup");
    }
  };
  reader.readAsText(file);
}

async function fetchText(path: string) {
  const response = await fetch(`/lb${path}`);
  if (!response.ok) throw new Error(`Letterboxd returned ${response.status}`);
  return response.text();
}

function getMaxPage(html: string) {
  const pages = [...html.matchAll(/\/films\/page\/(\d+)\//g)].map((match) => Number(match[1]));
  return Math.max(1, ...pages);
}

function parseMovies(html: string, name: string) {
  const parsed: Movie[] = [];
  const seen = new Set<string>();
  const pattern =
    /data-item-name="([^"]+)"[\s\S]*?data-item-slug="([^"]+)"[\s\S]*?data-item-link="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    const fullName = decodeHtml(match[1]);
    const { title, year } = stripYear(fullName);
    const slug = decodeHtml(match[2]);
    const link = decodeHtml(match[3]);
    if (seen.has(slug)) continue;
    seen.add(slug);
    parsed.push({
      id: slug,
      title,
      year,
      slug,
      letterboxdUrl: `https://letterboxd.com${link.startsWith("/") ? link : `/${name}/film/${slug}/`}`,
      posterUrl: null,
    });
  }

  return parsed;
}

function parseRssPosters(rss: string, name: string) {
  const posters = new Map<string, string>();
  const itemPattern = /<item>[\s\S]*?<\/item>/g;
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const itemMatch of rss.matchAll(itemPattern)) {
    const item = itemMatch[0];
    const link = item.match(new RegExp(`<link>https://letterboxd\\.com/${safeName}/film/([^/]+)/(?:\\d+/)?</link>`));
    const image = item.match(/<img src="([^"]+)"/);
    if (!link || !image) continue;
    posters.set(decodeHtml(link[1]), decodeHtml(image[1]));
  }

  return posters;
}

function parseStructuredPoster(html: string) {
  const imageMatch = html.match(/"image":"([^"]+-0-\d+-0-\d+-crop\.jpg\?v=[^"]+)"/);
  return imageMatch ? decodeHtml(imageMatch[1].replaceAll("\\/", "/")) : null;
}

async function backfillPoster(movie: Movie) {
  if (movie.posterUrl) return movie;
  try {
    const html = await fetchText(`/film/${movie.slug}/`);
    return { ...movie, posterUrl: parseStructuredPoster(html) };
  } catch {
    return movie;
  }
}

async function loadUsername(nextUsername: string) {
  const name = nextUsername.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Use a plain Letterboxd username.");
  }

  const cached = loadCachedMovies(name);
  if (cached) {
    username = name;
    movies = cached;
    movieById = new Map(movies.map((movie) => [movie.id, movie]));
    state = loadState();
    saveState();
    render();
    setLoading(`Refreshing ${name}...`);
  }

  setLoading(cached ? `Refreshing ${name}...` : `Loading ${name}...`);
  const firstPage = await fetchText(`/${name}/films/`);
  const pageCount = getMaxPage(firstPage);
  const pages = [firstPage];
  for (let page = 2; page <= pageCount; page += 1) {
    setLoading(`Loading ${name}: page ${page} of ${pageCount}...`);
    pages.push(await fetchText(`/${name}/films/page/${page}/`));
  }

  let rssPosters = new Map<string, string>();
  try {
    rssPosters = parseRssPosters(await fetchText(`/${name}/rss/`), name);
  } catch {
    rssPosters = new Map();
  }

  const byId = new Map<string, Movie>();
  for (const page of pages) {
    for (const movie of parseMovies(page, name)) {
      if (!byId.has(movie.id)) byId.set(movie.id, movie);
    }
  }

  const loadedMovies = [...byId.values()]
    .map((movie) => ({ ...movie, posterUrl: rssPosters.get(movie.slug) ?? null }))
    .sort((a, b) => {
      if (a.year === b.year) return a.title.localeCompare(b.title);
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });

  if (loadedMovies.length < 2) throw new Error(`Could not find enough public films for ${name}.`);

  username = name;
  movies = loadedMovies;
  movieById = new Map(movies.map((movie) => [movie.id, movie]));
  saveMovies(username, movies);
  state = loadState();
  saveState();
  render();
  fillPostersInBackground();
}

function setLoading(message: string) {
  $("#load-status").textContent = message;
}

async function fillPostersInBackground() {
  const missing = movies.filter((movie) => !movie.posterUrl);
  if (!missing.length) return;

  for (let index = 0; index < missing.length; index += 12) {
    setLoading(`Fetching posters: ${Math.min(index + 12, missing.length)} of ${missing.length}...`);
    const filled = await Promise.all(missing.slice(index, index + 12).map(backfillPoster));
    for (const movie of filled) {
      const target = movies.find((item) => item.id === movie.id);
      if (target) target.posterUrl = movie.posterUrl;
    }
    saveMovies(username, movies);
    render();
  }
  setLoading("");
}

function render() {
  const current = currentMovies();
  const answered = choicesMade();
  const threshold = revealThreshold();
  const revealPercent = threshold ? Math.min(100, (answered / threshold) * 100) : 0;
  const uniquePairs = uniquePairsCompared();
  const coverageComplete = Object.values(state.ratings).filter((rating) => rating.seen >= initialCoverageTarget).length;
  const coveragePercent = movies.length ? Math.min(100, (coverageComplete / movies.length) * 100) : 0;
  const isRefining = movies.length > 0 && coverageComplete === movies.length;

  (document.querySelector<HTMLInputElement>("#username")!).value = username;
  $("#title").textContent = "Letterboxd Ranker";
  $("#film-count").textContent = movies.length.toLocaleString();
  $("#answered-count").textContent = answered.toLocaleString();
  $("#pair-count").textContent = uniquePairs.toLocaleString();
  $("#reveal-threshold").textContent = threshold.toLocaleString();
  $("#skipped-count").textContent = state.skipped.toLocaleString();
  $("#reveal-progress").textContent = `${Math.floor(revealPercent)}%`;
  $("#coverage-progress").textContent = `${Math.floor(coveragePercent)}%`;
  $("#mode").textContent = isRefining ? "Refining close calls" : "Initial coverage";
  $("#reveal-meter").style.width = `${revealPercent}%`;
  $("#coverage-meter").style.width = `${coveragePercent}%`;
  $("#load-status").textContent = "";

  if (!current) {
    $("#pair-area").innerHTML = `<div class="done">Load an account with at least two public films.</div>`;
    renderLeaderboard();
    return;
  }

  renderMovieCard($("#left-card"), current.left, "left");
  renderMovieCard($("#right-card"), current.right, "right");
  $(".choose-left").addEventListener("click", () => vote(current.left.id, current.right.id));
  $(".choose-right").addEventListener("click", () => vote(current.right.id, current.left.id));
  renderLeaderboard();
}

function wireEvents() {
  $("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadUsername(document.querySelector<HTMLInputElement>("#username")!.value);
    } catch (error) {
      setLoading(error instanceof Error ? error.message : "Could not load account");
    }
  });
  $("#skip").addEventListener("click", skipPair);
  $("#undo").addEventListener("click", undo);
  $("#reset").addEventListener("click", reset);
  $("#draw").addEventListener("click", () => {
    const current = currentMovies();
    if (!current) return;
    vote(current.left.id, current.right.id, true);
  });
  $("#backup").addEventListener("click", openBackupDialog);
  $("#backup-export").addEventListener("click", () => {
    exportJson();
    closeBackupDialog();
  });
  $("#backup-import").addEventListener("click", () => document.querySelector<HTMLInputElement>("#restore-file")!.click());
  $("#backup-close").addEventListener("click", closeBackupDialog);
  $("#csv-export").addEventListener("click", exportLeaderboardCsv);
  $("#intro-close").addEventListener("click", closeIntro);
  $("#restore-file").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) restoreJson(file);
    (event.target as HTMLInputElement).value = "";
  });

  window.addEventListener("keydown", (event) => {
    const current = currentMovies();
    if (!current) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      vote(current.left.id, current.right.id);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      vote(current.right.id, current.left.id);
    }
    if (event.key.toLowerCase() === "d") vote(current.left.id, current.right.id, true);
    if (event.key.toLowerCase() === "s") skipPair();
    if (event.key.toLowerCase() === "u") undo();
  });
}

function openBackupDialog() {
  $("#backup-dialog").hidden = false;
}

function closeBackupDialog() {
  $("#backup-dialog").hidden = true;
}

function closeIntro() {
  localStorage.setItem(INTRO_KEY, "true");
  $("#intro-overlay").hidden = true;
}

function showIntroIfNeeded() {
  if (localStorage.getItem(INTRO_KEY)) return;
  $("#intro-overlay").hidden = false;
}

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="site-header">
    <div>
      <h1 id="title"></h1>
    </div>
    <div class="header-actions">
      <button id="backup" type="button">Backup</button>
      <button id="reset" type="button">Reset</button>
      <input id="restore-file" type="file" accept="application/json,.json" hidden>
    </div>
  </header>

  <div id="backup-dialog" class="popup" hidden>
    <div class="popup-box small">
      <h2>Backup</h2>
      <p>Save this account's movies and ranking state, or restore a previous JSON export.</p>
      <div class="popup-actions">
        <button id="backup-export" type="button">Export JSON</button>
        <button id="backup-import" type="button">Load JSON</button>
        <button id="backup-close" type="button">Close</button>
      </div>
    </div>
  </div>

  <div id="intro-overlay" class="intro-overlay" hidden>
    <div class="popup-box intro">
      <h2>Letterboxd Ranker</h2>
      <p>This app turns a public Letterboxd film list into a personal preference ranking. It shows two movies at a time, records which one you like better, and uses those choices to build a leaderboard. The leaderboard stays hidden at first so the early results do not overfit a tiny sample, then it keeps improving by repeating close or under-tested comparisons.</p>
      <h3>Keyboard shortcuts</h3>
      <table>
        <tr><th>Left arrow</th><td>Prefer the left movie</td></tr>
        <tr><th>Right arrow</th><td>Prefer the right movie</td></tr>
        <tr><th>D</th><td>Tie or unsure</td></tr>
        <tr><th>S</th><td>Skip this pair for later</td></tr>
        <tr><th>U</th><td>Undo the last answer</td></tr>
      </table>
      <button id="intro-close" class="big-close" type="button">Close</button>
    </div>
  </div>

  <form id="account-form" class="account-form">
    <label for="username">Letterboxd username</label>
    <input id="username" name="username" autocomplete="off" spellcheck="false">
    <button type="submit">Load account</button>
    <span id="load-status"></span>
  </form>

  <section class="status-grid" aria-label="status">
    <table>
      <tr><th>Films</th><td id="film-count"></td></tr>
      <tr><th>Unique pairs compared</th><td id="pair-count"></td></tr>
      <tr><th>Choices made</th><td id="answered-count"></td></tr>
      <tr><th>Skipped/deferred</th><td id="skipped-count"></td></tr>
      <tr><th>Mode</th><td id="mode"></td></tr>
    </table>
    <table>
      <tr><th>Leaderboard reveal</th><td><span id="reveal-progress"></span> of <span id="reveal-threshold"></span> choices</td></tr>
      <tr><td colspan="2"><div class="meter"><span id="reveal-meter"></span></div></td></tr>
      <tr><th>Initial coverage</th><td id="coverage-progress"></td></tr>
      <tr><td colspan="2"><div class="meter"><span id="coverage-meter"></span></div></td></tr>
    </table>
  </section>

  <main id="pair-area" class="pair-area">
    <article id="left-card" class="movie-card"></article>
    <div class="middle-controls">
      <button id="draw" type="button">Tie / unsure (D)</button>
      <button id="skip" type="button">Skip for later (S)</button>
      <button id="undo" type="button">Undo (U)</button>
    </div>
    <article id="right-card" class="movie-card"></article>
  </main>

  <section class="leaderboard-section">
    <div class="section-title">
      <h2>Leaderboard</h2>
      <div class="leaderboard-actions">
        <p id="leaderboard-note"></p>
        <button id="csv-export" type="button">Export as CSV</button>
      </div>
    </div>
    <table class="leaderboard">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Movie</th>
          <th>Year</th>
          <th>Score</th>
          <th>Compared</th>
        </tr>
      </thead>
      <tbody id="leaderboard-body"></tbody>
    </table>
  </section>
`;

wireEvents();
render();
showIntroIfNeeded();
