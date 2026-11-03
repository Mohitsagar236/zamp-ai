import { AuthError } from "./auth";

// Count bytes as they arrive, before multipart/JSON allocation, including
// chunked requests whose Content-Length is absent or inaccurate.
export async function boundedBody(
  request: Request,
  limit: number,
  timeoutMs = 30000,
): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new AuthError(413, "Request exceeds the configured size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AuthError(408, "Request body timed out.")),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new AuthError(413, "Request exceeds the configured size limit.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
