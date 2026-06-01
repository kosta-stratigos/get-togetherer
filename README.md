# Get Togetherer

A small dependency-free web app for finding dates that work for a group of friends.

## GitHub Pages

[https://kosta-stratigos.github.io/get-togetherer/](https://kosta-stratigos.github.io/get-togetherer/)

GitHub Pages serves the frontend app from the repository root.

Poll creation and responses are handled by the Cloudflare Worker API. After deploying the Worker, set `GET_TOGETHERER_API_BASE_URL` in `index.html` to the Worker origin, for example:

```html
<script>
  window.GET_TOGETHERER_API_BASE_URL = "https://get-togetherer-api.kosta-stratigos.workers.dev";
</script>
```

The included `404.html` redirects shared poll links back into the app so URLs like `/get-togetherer/poll/<id>` can be opened directly.

## Cloudflare API

The production API is configured for Cloudflare Workers and D1.

- Worker name: `get-togetherer-api`
- Worker URL: [https://get-togetherer-api.kosta-stratigos.workers.dev](https://get-togetherer-api.kosta-stratigos.workers.dev)
- Worker entrypoint: `worker/index.js`
- D1 migration: `migrations/0001_initial.sql`
- Health check: `/api/health`

Create the D1 database and copy the returned `database_id` into `wrangler.toml`:

```sh
npx wrangler d1 create get-togetherer
```

Apply the D1 schema and deploy the Worker:

```sh
npm run worker:migrate:remote
npm run worker:deploy
```

Then update `GET_TOGETHERER_API_BASE_URL` in `index.html` and push the change so GitHub Pages can call the deployed API.

## Run

```sh
./start.sh
```

Then open [http://localhost:5173](http://localhost:5173).

The local Node server serves the frontend and API from the same origin, so no API base URL is needed for local development.

To run the Worker API locally instead:

```sh
npm install
npm run worker:migrate:local
npm run worker:dev
```

## What It Does

- Creates a poll with a date range and selected days of the week.
- Gives you a single poll link to share however you like.
- Lets each person enter their name and save the dates that work for them.
- Shows everyone the shared response table and highlights the dates with the most positive responses.

Production poll data is stored in Cloudflare D1. The local Node server stores development data in `data/polls.json`.
