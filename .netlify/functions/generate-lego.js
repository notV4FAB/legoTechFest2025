// generate-lego.js  (Netlify function)
'use strict';

const DEFAULT_TIMEOUT_MS = 45_000;

exports.handler = async function (event, context) {
  const respond = (statusCode, payload) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(payload)
  });

  try {
    // parse body safely
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const image_base64 = body?.image_base64;

    if (!image_base64) {
      console.error('No image_base64 provided');
      return respond(400, { error: 'No image_base64 provided' });
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      console.warn('WORDWARE_API_KEY missing');
      // return 500 but with clear message so client can fallback
      return respond(500, { error: 'WORDWARE_API_KEY missing in environment' });
    }

    // safety size guard
    const MAX_BASE64_LENGTH = 9_000_000;
    if (typeof image_base64 !== 'string' || image_base64.length > MAX_BASE64_LENGTH) {
      console.error('image_base64 too large or invalid');
      return respond(400, { error: 'image_base64 missing or too large' });
    }

    // call Wordware
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const payload = {
      version: '^1.0',
      inputs: {
        photo: { type: 'image', image_url: `data:image/jpeg;base64,${image_base64}` }
      }
    };

    let wres;
    try {
      wres = await fetch('https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WORDWARE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error('Fetch to Wordware failed:', e?.message || e);
      return respond(502, { error: 'Failed to reach Wordware', detail: e?.message || String(e) });
    }
    clearTimeout(timeout);

    if (!wres.ok) {
      const txt = await wres.text().catch(() => null);
      console.error('Wordware returned non-ok:', wres.status, txt);
      return respond(wres.status || 502, { error: 'Wordware API returned error', status: wres.status, detail: txt });
    }

    const data = await wres.json().catch(() => null);
    if (!data) {
      console.error('Wordware returned invalid JSON');
      return respond(500, { error: 'Empty/invalid JSON from Wordware' });
    }

    // try multiple possible shapes for returned image
    const resultUrl =
      data.output_image_url ||
      data.outputs?.photo?.image_url ||
      data.result?.url ||
      data.outputs?.[0]?.image_url ||
      data.outputs?.[0]?.url ||
      null;

    const inlineB64 =
      data.output_base64 ||
      data.outputs?.photo?.base64 ||
      data.outputs?.[0]?.base64 ||
      null;

    if (inlineB64) {
      const dataUrl = `data:image/jpeg;base64,${inlineB64}`;
      console.log('Wordware returned inline base64');
      return respond(200, { result_url: resultUrl || null, data_url: dataUrl });
    }

    if (!resultUrl) {
      console.error('Unexpected Wordware response structure:', JSON.stringify(data).slice(0, 2000));
      return respond(500, { error: 'Unexpected Wordware response structure', rawSample: data });
    }

    // fetch the generated image server-side to bypass CORS for the client
    let imageResp;
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 20_000);
    try {
      imageResp = await fetch(resultUrl, { signal: fetchController.signal });
    } catch (e) {
      clearTimeout(fetchTimeout);
      console.error('Failed to fetch result image:', e?.message || e);
      return respond(502, { error: 'Failed to fetch generated image', detail: e?.message || String(e), result_url: resultUrl });
    }
    clearTimeout(fetchTimeout);

    if (!imageResp.ok) {
      const txt = await imageResp.text().catch(() => null);
      console.error('Result image fetch failed:', imageResp.status, txt);
      return respond(502, { error: 'Result image fetch failed', status: imageResp.status, detail: txt, result_url: resultUrl });
    }

    const contentType = imageResp.headers.get('content-type') || 'image/png';
    const arrBuf = await imageResp.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    const b64 = buffer.toString('base64');
    const dataUrl = `data:${contentType};base64,${b64}`;

    console.log('Successfully proxied image; returning data_url to client.');
    return respond(200, { result_url: resultUrl, data_url: dataUrl });

  } catch (err) {
    console.error('Unhandled error in generate-lego:', err);
    return respond(500, { error: err?.message || String(err) });
  }
};
