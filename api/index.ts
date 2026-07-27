/**
 * Vercel entry point.
 *
 * Vercel runs functions, not long-lived servers, so it imports the Express app
 * rather than the app binding a port. `vercel.json` routes every /api/* request
 * here, and Express does its own routing from there.
 */
export { default } from "../server/index.js";
