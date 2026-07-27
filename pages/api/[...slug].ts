/**
 * Express, mounted inside Next.js.
 *
 * A root-level /api directory only becomes serverless functions on projects
 * with no framework; on a Next.js project Vercel ignores it. A Pages-router
 * API route is the way in, because it runs on the Node runtime and hands the
 * handler real Node req/res objects — which is exactly what an Express app is
 * already a function of, so the app can be exported straight through.
 *
 * bodyParser is off so Express's own express.json() still sees an unread
 * stream; letting Next parse first leaves Express with an empty body.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import app from "@/server/index";

export const config = {
  api: { bodyParser: false, externalResolver: true },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return (app as unknown as (a: NextApiRequest, b: NextApiResponse) => void)(req, res);
}
