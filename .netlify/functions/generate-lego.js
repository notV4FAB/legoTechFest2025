// generate-lego.js  (Netlify function, CommonJS)
// Reintentos, timeouts, robust parsing, descarga server-side y retorno data_url.
// Requiere: WORDWARE_API_KEY en env vars de Netlify.

'use strict';

const DEFAULT_WORDWARE_TIMEOUT = 45_000; // ms
const DEFAULT_FETCH_IMAGE_TIMEOUT = 20_000;
const MAX_BASE64_LENGTH = 9_000_000; // guard

// small helper: sleep
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function makeResponse(statusCode, payload){
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(payload)
  };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

exports.handler = async function(event, context) {
  try {
    // parse body safely
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const image_base64 = body?.image_base64;
    if(!image_base64){
      console.error('[generate-lego] missing image_base64');
      return makeResponse(400, { error: 'No image_base64 provided' });
    }
    if(typeof image_base64 !== 'string' || image_base64.length > MAX_BASE64_LENGTH){
      console.error('[generate-lego] image_base64 invalid/too large, length:', image_base64.length);
      return makeResponse(400, { error: 'image_base64 invalid or too large', length: image_base64.length });
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if(!WORDWARE_API_KEY){
      console.error('[generate-lego] WORDWARE_API_KEY missing in env');
      return makeResponse(500, { error: 'WORDWARE_API_KEY missing in environment' });
    }

    const wordwareUrl = 'https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run';
    const payload = {
      version: '^1.0',
      inputs: {
        photo: { type: 'image', image_url: `data:image/jpeg;base64,${image_base64}` }
      }
    };

    // Try up to 3 attempts (initial + 2 retries) on transient failures
    let attempt = 0;
    let wordwareRes = null;
    let lastErr = null;
    const maxAttempts = 3;
    for(attempt = 1; attempt <= maxAttempts; attempt++){
      try{
        console.log(`[generate-lego] Wordware attempt ${attempt}`);
        wordwareRes = await fetchWithTimeout(wordwareUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${WORDWARE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }, DEFAULT_WORDWARE_TIMEOUT);

        // if non-OK and status 429/5xx -> consider retry
        if(!wordwareRes.ok){
          const txt = await wordwareRes.text().catch(()=>null);
          console.warn(`[generate-lego] Wordware returned ${wordwareRes.status} (attempt ${attempt}) - ${String(txt).slice(0,300)}`);
          if(wordwareRes.status >= 500 || wordwareRes.status === 429){
            lastErr = { type: 'http', status: wordwareRes.status, text: txt };
            if(attempt < maxAttempts) await sleep(1200 * attempt); // backoff
            continue; // retry
          } else {
            // client error (4xx other than 429) -> don't retry
            return makeResponse(wordwareRes.status, { error: 'Wordware returned non-success', status: wordwareRes.status, detail: txt });
          }
        }

        // ok
        break;
      } catch (e){
        lastErr = e;
        console.error(`[generate-lego] attempt ${attempt} failed:`, e?.message || e?.name || e);
        if(attempt < maxAttempts) await sleep(1200 * attempt);
        else break;
      }
    }

    if(!wordwareRes || !wordwareRes.ok){
      console.error('[generate-lego] Wordware failed after attempts', lastErr);
      return makeResponse(502, { error: 'Wordware call failed', detail: lastErr?.message || lastErr });
    }

    // parse response JSON
    const data = await wordwareRes.json().catch((e)=>{
      console.error('[generate-lego] Error parsing JSON from Wordware:', e);
      return null;
    });
    if(!data){
      return makeResponse(500, { error: 'Empty/invalid JSON from Wordware' });
    }

    // robust extraction
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

    if(inlineB64){
      console.log('[generate-lego] Wordware returned inline base64');
      const dataUrl = `data:image/jpeg;base64,${inlineB64}`;
      return makeResponse(200, { result_url: resultUrl || null, data_url: dataUrl });
    }

    if(!resultUrl){
      console.error('[generate-lego] Unexpected Wordware response shape; sample:', JSON.stringify(data).slice(0,2000));
      return makeResponse(500, { error: 'Unexpected Wordware response structure', rawSample: data });
    }

    // Fetch generated image server-side to avoid CORS (and return data_url)
    try {
      console.log('[generate-lego] fetching result_url server-side:', resultUrl);
      const imgResp = await fetchWithTimeout(resultUrl, {}, DEFAULT_FETCH_IMAGE_TIMEOUT);
      if(!imgResp.ok){
        const txt = await imgResp.text().catch(()=>null);
        console.error('[generate-lego] fetching result image failed:', imgResp.status, txt);
        return makeResponse(502, { error: 'Failed to fetch generated image', status: imgResp.status, detail: txt, result_url: resultUrl });
      }
      const contentType = imgResp.headers.get('content-type') || 'image/png';
      const arrBuf = await imgResp.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      const b64 = buf.toString('base64');
      const dataUrl = `data:${contentType};base64,${b64}`;
      console.log('[generate-lego] success. returning data_url (length):', dataUrl.length);
      return makeResponse(200, { result_url: resultUrl, data_url: dataUrl });
    } catch (e){
      console.error('[generate-lego] error fetching result_url:', e?.message || e);
      return makeResponse(502, { error: 'Error fetching result image', detail: e?.message || String(e), result_url: resultUrl });
    }

  } catch (err){
    console.error('[generate-lego] unhandled error:', err);
    return makeResponse(500, { error: err?.message || String(err) });
  }
};
