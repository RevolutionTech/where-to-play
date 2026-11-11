// Vercel only creates functions from the root api/ directory. `pnpm build` bundles the server
// first, because Vercel's own TypeScript compile keeps imports without file extensions, and
// Node.js cannot resolve those in an ES module package.
export { default } from "../server/dist/vercel.js";
