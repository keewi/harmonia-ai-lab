import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";

/**
 * Share links (/s/<token>) are open: the token is the key. Everything else
 * sits behind the shared password, except on the hosted copy (LAB_HOSTED=1),
 * which serves share links and nothing else. It has no uploads, no pipeline
 * and no runs folder, so there is nothing else there to reach.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/s/") || pathname === "/api/hit") return NextResponse.next();
  if (process.env.LAB_HOSTED === "1") return new NextResponse("Not found", { status: 404 });
  if (pathname === "/login") return NextResponse.next();
  const token = await sessionToken();
  if (token && request.cookies.get(AUTH_COOKIE)?.value === token) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|fonts/|brand/|favicon.ico).*)"],
};
