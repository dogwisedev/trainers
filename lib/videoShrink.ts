// Make a video smaller on the phone before it's sent (like WhatsApp, but kinder to quality): the long side at most 1920
// pixels (1080p), about 3 Mbps, H.264 in an MP4. Uses the browser's own video encoder (WebCodecs) through Mediabunny,
// loaded only when a video is shrunk. Anything it can't do (an older phone, a format it can't read, the sound would be
// lost) returns null, and the original is sent as before: nothing ever gets stuck here.

export type Shrunk = { blob: Blob; name: string; type: string };
const LONG_SIDE = 1920, BITRATE = 3_000_000;

export async function shrinkVideo(file: File, onProgress: (p: number) => void): Promise<Shrunk | null> {
  try {
    if (typeof window === "undefined" || !("VideoEncoder" in window) || !("VideoDecoder" in window)) return null;
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const w = track.displayWidth, h = track.displayHeight, long = Math.max(w, h);
    const scale = long > LONG_SIDE ? LONG_SIDE / long : 1;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    if (!(await mb.canEncodeVideo("avc", { width: even(w * scale), height: even(h * scale), bitrate: BITRATE }))) return null;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { width: even(w * scale), height: even(h * scale), fit: "contain", codec: "avc", bitrate: BITRATE },
      audio: {} // the sound as it is (copied when the phone recorded AAC, as phones do)
    });
    // Never lose the sound (or the picture): if any track would be dropped, send the original instead
    if (!conversion.isValid || conversion.discardedTracks.length) return null;
    conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(1, p)));
    await conversion.execute();
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf || buf.byteLength >= file.size * 0.9) return null; // not worth it: send the original
    return { blob: new Blob([buf], { type: "video/mp4" }), name: file.name.replace(/\.[^.]+$/, "") + ".mp4", type: "video/mp4" };
  } catch { return null; }
}
