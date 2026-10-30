import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "./lib/auth";
import { InputError } from "./lib/storage";
export function proxy(request: NextRequest) {
  try {
    authorize(request);
    return NextResponse.next();
  } catch (e) {
    const status = e instanceof InputError ? e.status : 403;
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
  matcher: ["/((?!api|_next/static|_next/image|samples).*)"],
};
