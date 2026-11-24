# Running rab

## Local development

Use Node.js 22 or later for the built-in SQLite module. From the repository root, run:

```sh
./setup.sh
pnpm run dev
```

Setup prepares the environment file, dependencies and database, and looks for a public Mapbox token in a sibling project. The development server serves the API and frontend together at `http://localhost:3016` by default.

Set `PORT` for the server port, `PM2_NAME` for the process name and `VITE_MAPBOX_TOKEN` to enable maps. Optional settings for email and iPhone photo descriptions are documented in [the environment example](../.env.example).

## Run the production build

```sh
pnpm run build
./start.sh
```

`./start.sh` runs the build under PM2. To pull the latest code, install dependencies, rebuild and restart the server, run `./restart.sh`.
