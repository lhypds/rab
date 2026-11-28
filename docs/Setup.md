# Running rab

## Local development

Use Node.js 22 or later for the built-in SQLite module. From the repository root, run:

```sh
./setup.sh
pnpm run dev
```

Setup prepares the environment file, dependencies and database, and looks for a public Mapbox token in a sibling project. The development server serves the API and frontend together at `http://localhost:3016` by default.

Set `PORT` for the server port, `PM2_NAME` for the process name and `VITE_MAPBOX_TOKEN` to enable maps. Optional settings for email and iPhone photo descriptions are documented in [the environment example](../.env.example).

Which OpenAI model each AI request uses is set in `settings.json`, made from [settings.json.example](../settings.json.example) by `setup.sh` (and by `restart.sh` where it is missing): `models.default` is the model of every request, and `describePhoto`, `describeObject`, `classifyListing`, `describeRequest` and `guide` (the top bar's Ask AI) each name another for that one request — left empty, the default. The file is read again whenever it changes; the server need not be restarted.

## Run the production build

```sh
pnpm run build
./start.sh
```

`./start.sh` runs the build under PM2. To pull the latest code, install dependencies, rebuild and restart the server, run `./restart.sh`.

The `./rab` command does the same for the server and the iPhone app: `./rab restart` asks which (server, ios or all), `./rab restart ios device` rebuilds and reopens the app on the paired iPhone, `./rab ios restart` asks for an iPhone or simulator, and `./rab help` lists the rest. `./install.sh` links it as `rab` in `/usr/local/bin`.
