import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";

/**
 * Share links (/s/<token>) and the visit beacon are open: the token is the key.
 * Everything else needs the shared password.
 *
 * On the hosted copy (LAB_HOSTED=1) that "everything else" is only the library:
 * Past rehearsals, each rehearsal's results and its PDFs. Uploading,
 * processing and sharing exist only on the Mac, so those routes are 404 there.
 */
const HOSTED_LIBRARY = /^\/(history|runs\/[a-z0-9-]+|library\/[a-z0-9-]+\/file\/\d+)$/;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/s/") || pathname === "/api/hit" || pathname === "/login") return NextResponse.next();

  const hosted = process.env.LAB_HOSTED === "1";
  if (hosted && pathname !== "/" && !HOSTED_LIBRARY.test(pathname)) return new NextResponse("Not found", { status: 404 });

  const token = await sessionToken();
  const signedIn = Boolean(token && request.cookies.get(AUTH_COOKIE)?.value === token);
  if (signedIn) {
    if (hosted && pathname === "/") return NextResponse.redirect(new URL("/history", request.url));
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/library/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|fonts/|brand/|favicon.ico).*)"],
};
