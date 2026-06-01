# Get Togetherer

A small dependency-free web app for finding dates that work for a group of friends.

## GitHub Pages

[https://kosta-stratigos.github.io/get-togetherer/](https://kosta-stratigos.github.io/get-togetherer/)

GitHub Pages serves the frontend app from the repository root.

Poll creation and responses require the Node API. After deploying the Node server, update `GET_TOGETHERER_API_BASE_URL` in `index.html` to the deployed API origin, for example:

```html
<script>
  window.GET_TOGETHERER_API_BASE_URL = "https://your-get-togetherer-api.example.com";
</script>
```

The included `404.html` redirects shared poll links back into the app so URLs like `/get-togetherer/poll/<id>` can be opened directly.

## Run

```sh
./start.sh
```

Then open [http://localhost:5173](http://localhost:5173).

The local Node server serves the frontend and API from the same origin, so no API base URL is needed for local development.

## What It Does

- Creates a poll with a date range and selected days of the week.
- Gives you a single poll link to share however you like.
- Lets each person enter their name and save the dates that work for them.
- Shows everyone the shared response table and highlights the dates with the most positive responses.

Poll data is stored locally in `data/polls.json` on the server.
