import "server-only";
import crypto from "node:crypto";

// A file only counts as report media if the server confirmed it was uploaded into that booking's folder.
// The confirmation is signed, so a trainer can't paste in some other Drive link.
const key = () => process.env.MEDIA_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BB_KEY || "dogwise-dev-key";
export const signMedia = (fileId: string, bookingId: string) => crypto.createHmac("sha256", key()).update(`${bookingId}:${fileId}`).digest("hex").slice(0, 24);
export const verifyMedia = (fileId: string, bookingId: string, sig?: string) => !!sig && sig.length === 24 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signMedia(fileId, bookingId)));
