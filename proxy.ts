import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - models/ (3D assets for the designer -- these are fetched by the browser
     *   after the page has already been authorized, and sending each one through
     *   an auth round-trip only adds a Supabase call per multi-megabyte request)
     * - ph-address/ (the public PSGC province/city/barangay lists the address
     *   picker reads; the same for everyone, and nothing to authorize)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * - 3D assets - .gltf, .glb, .bin, .hdr, .ktx2
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|models/|ph-address/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|gltf|glb|bin|hdr|ktx2)$).*)",
  ],
};
