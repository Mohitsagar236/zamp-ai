import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth";

export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
function dispatch(
  request: Request,
  handler: (request: Request) => Promise<Response>,
) {
  if (new URL(request.url).pathname.includes("/api/auth/admin/"))
    return Response.json(
      { error: "Use the audited workspace administration route." },
      { status: 404 },
    );
  return handler(request);
}
export const GET = (request: Request) => dispatch(request, handlers.GET);
export const POST = (request: Request) => dispatch(request, handlers.POST);
