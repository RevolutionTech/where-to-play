# Where to Play

Search for a board game by name, and find the conventions and board game cafes that have it in their collection.

## Requirements

- Node.js 26 or later (see `.nvmrc`)
- pnpm 12
- Docker, for the local database. On macOS, [OrbStack](https://orbstack.dev) works well. It is free for personal use.

## Getting Started

```bash
pnpm install
cp server/.env.example server/.env
pnpm db:setup
pnpm dev
```

`pnpm db:setup` starts PostgreSQL in Docker, applies the migrations, and loads sample data.

Then open http://localhost:5173. The client sends `/api` requests to the server on port 3000.

To change server settings, edit `server/.env`. To start again with an empty database, run `pnpm db:reset`.

## Documentation

- [Architecture](docs/architecture.md)
- [Decision records](docs/decisions/)
- [AGENTS.md](AGENTS.md): guide for AI coding agents and a quick reference for commands
