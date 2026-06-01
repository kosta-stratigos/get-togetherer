# Get Togetherer

A small dependency-free web app for finding dates that work for a group of friends.

## GitHub Pages

[https://kosta-stratigos.github.io/get-togetherer/](https://kosta-stratigos.github.io/get-togetherer/)

GitHub Pages serves this repository's project page. The interactive poll app itself uses the Node server below because poll responses are saved through the local API.

## Run

```sh
./start.sh
```

Then open [http://localhost:5173](http://localhost:5173).

## What It Does

- Creates a poll with a date range and selected days of the week.
- Gives you a single poll link to share however you like.
- Lets each person enter their name and save the dates that work for them.
- Shows everyone the shared response table and highlights the dates with the most positive responses.

Poll data is stored locally in `data/polls.json` on the server.
