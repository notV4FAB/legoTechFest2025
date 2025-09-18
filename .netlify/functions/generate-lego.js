// generate-lego.js
// Netlify function (Node 18+). Proxies image to Wordware, fetches the generated image and returns it as data URL
// (to avoid client-side CORS issues).
// Requires: process.env.WORDWARE_API_KEY

export async function handler(event, context) {
  try {
    // Parse body safely
    const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : (event.body || {});
    const image_base64 = body?.image_base64;
    if (!image_base64) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No image_base64 provided" })
      };
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "WORDWARE_API_KEY missing in environment" })
      };
    }

    // Safety: limit maximum size we will forward (in bytes). This is a guard.
    // If base64 length is excessive, reject early. Example limit: 6.5MB base64 ~ ~4.9MB binary.
    const MAX_BASE64_LENGTH = 9_000_000; // conservative
    if (typeof image_base64 !== "string" || image_base64.length > MAX_BASE64_LENGTH) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "image_base64 missing or too large" })
      };
    }

    // Prepare Wordware request
    const controller = new AbortController();
    const timeoutMs = 45_000; // 45s timeout
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      version: "^1.0",
      inputs: {
        // Wordware in many examples accepts inline data URLs
        photo: { type: "image", image_url: `data:image/jpeg;base64,${image_base64}` }
      }
    };

    let wres;
    try {
      wres = await fetch("https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WORDWARE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      const msg = e.name === "AbortError" ? "Wordware request timed out" : (e.message || String(e));
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to reach Wordware", detail: msg })
      };
    }
    clearTimeout(timeout);

    if (!wres.ok) {
      const txt = await wres.text().catch(() => null);
      return {
        statusCode: wres.status || 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Wordware API returned error", status: wres.status, detail: txt })
      };
    }

    const data = await wres.json().catch(() => null);
    if (!data) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Empty JSON from Wordware" })
      };
    }

    // Several fallbacks for where the generated image URL or base64 might be
    const resultUrl =
      data.output_image_url ||
      data.outputs?.photo?.image_url ||
      data.result?.url ||
      data.outputs?.[0]?.image_url ||
      data.outputs?.[0]?.url ||
      null;

    // If Wordware returned an inline image/base64 directly, support it too
    // e.g. data.output_base64 or outputs[0].b64
    const inlineB64 =
      data.output_base64 ||
      data.outputs?.photo?.base64 ||
      data.outputs?.[0]?.base64 ||
      null;

    // If we have inline base64 -> return it as data URL immediately
    if (inlineB64) {
      // assume jpeg if not specified
      const dataUrl = `data:image/jpeg;base64,${inlineB64}`;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result_url: resultUrl || null, data_url: dataUrl })
      };
    }

    if (!resultUrl) {
      // Unexpected shape: return raw data for debugging (caller can log)
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected Wordware response structure", raw: data })
      };
    }

    // Fetch the result image from resultUrl (server-side) to avoid client CORS issues.
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 20000); // 20s to fetch image

    let imageResp;
    try {
      imageResp = await fetch(resultUrl, { signal: fetchController.signal });
    } catch (e) {
      clearTimeout(fetchTimeout);
      const msg = e.name === "AbortError" ? "Fetching result image timed out" : (e.message || String(e));
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to fetch generated image", detail: msg, result_url: resultUrl })
      };
    }
    clearTimeout(fetchTimeout);

    if (!imageResp.ok) {
      const t = await imageResp.text().catch(() => null);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Result image fetch failed", status: imageResp.status, detail: t, result_url: resultUrl })
      };
    }

    const contentType = imageResp.headers.get("content-type") || "image/png";
    const arrBuf = await imageResp.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    const b64 = buffer.toString("base64");
    const dataUrl = `data:${contentType};base64,${b64}`;

    // Return both result_url (for debugging) and the data_url for immediate use in client
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result_url: resultUrl, data_url: dataUrl })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err?.message || String(err) })
    };
  }
}
