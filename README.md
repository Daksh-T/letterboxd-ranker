# Letterboxd Ranker

Letterboxd Ranker is a lightweight web app for building a personal movie leaderboard from any public Letterboxd account.

Instead of asking you to assign star ratings or drag a huge list into order, it shows two films at a time and asks which one you prefer. Those pairwise choices are used to calculate an Elo-style score for each movie. The leaderboard unlocks after enough comparisons have been made, then keeps improving as you continue answering.

## What It Does

- Loads films from a public Letterboxd username.
- Presents simple head-to-head movie comparisons.
- Builds a ranked leaderboard from your choices.
- Keeps refining the ranking with close or under-tested matchups.
- Supports keyboard controls for quick voting.
- Exports the leaderboard as CSV.
- Backs up and restores ranking state as JSON.

## Elo-Style Scoring

Every movie starts with the same score, currently `1500`.

When you choose one movie over another, the app updates both scores:

- Beating a highly rated movie gives a larger gain.
- Beating a much lower rated movie gives a smaller gain.
- Losing to a lower rated movie costs more than losing to a higher rated movie.
- Choosing `Tie / unsure` moves both scores only slightly.

This is based on the same broad idea as Elo ratings in chess: the score change depends on both the result and the expected result. If an upset happens, the scores move more. If the expected favorite wins, the scores move less.

The scores are not meant to be universal movie ratings. They are only a model of your preferences based on the comparisons you have answered.

## Why The Leaderboard Starts Hidden

Early rankings can be misleading because only a few movies have been compared. Letterboxd Ranker hides the leaderboard until there is enough initial coverage. After that, the table unlocks and continues to get better as more comparisons are answered.

The app does not need to exhaust every possible pair. It keeps selecting useful future matchups, especially movies with close scores or too few comparisons.

## Run Locally

Install dependencies:

```sh
bun install
```

Start the development server:

```sh
bun run dev
```

Open:

```text
http://localhost:5173
```

## Build

```sh
bun run build
```

Preview the production build:

```sh
bun run preview
```

## Loading Letterboxd Accounts

Enter a public Letterboxd username and click `Load account`.

The app uses a local Vite proxy (`/lb/...`) to fetch Letterboxd pages, since browsers generally cannot request Letterboxd pages directly from frontend JavaScript due to CORS restrictions.

Loaded account data is cached in `localStorage`, so returning to an account is faster after the first load. Poster data may continue filling in after the movie list appears.

## Backup And Restore

Click `Backup` to open the backup menu.

- `Export JSON` saves the loaded movies and ranking state.
- `Load JSON` restores a previous backup.

The leaderboard can also be exported as CSV from the leaderboard header.

## Scraping A Default Dataset

The app can ship with a pre-scraped dataset in `src/data/movies.ts`.

Refresh the default data:

```sh
bun run scrape
```

Scrape a specific account into `src/data/movies.ts`:

```sh
bun run scripts/scrape-letterboxd.ts username
```

The scraper prefers Letterboxd's structured portrait poster images instead of social-share banner artwork.
