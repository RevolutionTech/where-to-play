# Where to Play

Search for a board game by name, and find the conventions and board game cafes that have it in their collection.

## Requirements

- Node.js 22.12 or later (see `.nvmrc`)
- pnpm 9

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173. The client sends `/api` requests to the server on port 3000.

To change server settings, copy `server/.env.example` to `server/.env`.

## Documentation

- [Architecture](docs/architecture.md)
- [Decision records](docs/decisions/)
- [AGENTS.md](AGENTS.md): guide for AI coding agents and a quick reference for commands
