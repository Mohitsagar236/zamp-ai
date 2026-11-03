import { NextResponse, type NextRequest } from "next/server";
import { authorize, AuthError } from "./lib/auth";
import { getSessionCookie } from "better-auth/cookies";
export function proxy(request: NextRequest) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.nextUrl.pathname).toLowerCase();
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (process.env.APP_ENV === "production" && pathname.startsWith("/samples/"))
    return new NextResponse("Not found", { status: 404 });
  if (process.env.AUTH_MODE === "individual") {
    if (request.nextUrl.pathname === "/sign-in") return NextResponse.next();
    if (!getSessionCookie(request))
      return NextResponse.redirect(new URL("/sign-in", request.url));
    return NextResponse.next();
  }
  try {
    authorize(request);
    return NextResponse.next();
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 403;
    return new NextResponse(
      "Private InvoiceLens workspace. Sign in to continue.",
      {
        status,
        headers:
          status === 401
            ? {
                "WWW-Authenticate":
                  'Basic realm="InvoiceLens", charset="UTF-8"',
              }
            : {},
      },
    );
  }
}
export const config = {
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};
