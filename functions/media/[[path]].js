// Byte ranges for the landing page's videos.
//
// Cloudflare Pages serves static files whole, even when the browser asks for a byte range. Safari (on
// iPhone, iPad and Mac) will not play a video from a server that does that: it asks for the first two
// bytes and gives up on a 200. Other browsers play it but cannot jump ahead in the long video until
// that part has downloaded. This function answers range requests with 206 Partial Content, straight
// from the Pages asset store. `_routes.json` (written by tools/build-site.mjs) sends only the .mp4
// files here, so pictures and everything else stay plain static files.
//
// The asset store hands the file over as a stream with no length, so the sizes are written at build
// time into sizes.json (by tools/build-site.mjs); a file missing from it is read whole instead.

import sizes from './sizes.json';

export async function onRequest({ request, next }) {
  const range = request.headers.get('Range');
  if (request.method !== 'GET' || !range) return next();
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const full = await next();
  if (!m || full.status !== 200 || !full.body || full.headers.get('Content-Encoding')) return full;
  let size = Number(full.headers.get('Content-Length')) || sizes[new URL(request.url).pathname] || 0;
  let whole = null;
  if (!size) {
    whole = new Uint8Array(await full.arrayBuffer());
    size = whole.byteLength;
  }
  let start;
  let end;
  if (m[1] === '') {
    // a suffix range: the last n bytes
    const n = Number(m[2]);
    if (!n) return whole ? new Response(whole, full) : full;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    if (!whole) await full.body.cancel();
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = new Headers(full.headers);
  headers.delete('Transfer-Encoding');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Accept-Ranges', 'bytes');
  if (whole) return new Response(whole.subarray(start, end + 1), { status: 206, headers });
  // The runtime ignores a Content-Length set by hand and would stream the part in chunks with no
  // length; a FixedLengthStream makes it send the exact length. From the start to the end is the
  // whole file, which passes straight through.
  const part = start === 0 && end === size - 1 ? full.body : slice(full.body, start, end + 1);
  const { readable, writable } = new FixedLengthStream(end - start + 1);
  part.pipeTo(writable).catch(() => undefined);
  return new Response(readable, { status: 206, headers });
}

/** The bytes [from, to) of a stream, reading no further than it needs. */
function slice(body, from, to) {
  const reader = body.getReader();
  let pos = 0;
  return new ReadableStream({
    async pull(ctl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          ctl.close();
          return;
        }
        const a = pos;
        pos += value.byteLength;
        if (pos <= from) continue;
        const s = Math.max(0, from - a);
        const e = Math.min(value.byteLength, to - a);
        if (e > s) ctl.enqueue(value.subarray(s, e));
        if (pos >= to) {
          ctl.close();
          await reader.cancel();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
