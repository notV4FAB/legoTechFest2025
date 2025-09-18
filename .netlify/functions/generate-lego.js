// generate-lego.js
// Netlify Function that forwards the image to Wordware and returns a result_url.
// Note: uses global fetch (Node 18+ / Netlify). No node-fetch import.

export async function handler(event, context) {
  try {
    // parse body safely (Netlify provides event.body as string)
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const image_base64 = body?.image_base64;
    if (!image_base64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No image_base64 provided' })
      };
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'WORDWARE_API_KEY missing in environment' })
      };
    }

    const res = await fetch('https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WORDWARE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '^1.0',
        inputs: {
          photo: { type: 'image', image_url: `data:image/png;base64,${image_base64}` }
        }
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        statusCode: res.status || 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Wordware API error', status: res.status, detail: text })
      };
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Empty JSON from Wordware' })
      };
    }

    // robust extraction with several fallbacks (Wordware response shapes vary)
    const resultUrl =
      data.output_image_url ||
      data.outputs?.photo?.image_url ||
      data.result?.url ||
      data.outputs?.[0]?.image_url ||
      data.outputs?.[0]?.url ||
      null;

    if (!resultUrl) {
      // return raw data for debugging (careful with secrets)
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unexpected Wordware response structure', raw: data })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_url: resultUrl })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || String(err) })
    };
  }
}
