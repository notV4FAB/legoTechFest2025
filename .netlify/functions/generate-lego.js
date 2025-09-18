// generate-lego.js (Netlify function — CommonJS)
// Attempts both supported payload shapes: { type: "image", image_url } and { type: "file", file_url, file_type, file_name }.
// Returns { result_url, data_url } on success (data_url is a data:<mime>;base64,... string).
'use strict';

const DEFAULT_WORDWARE_TIMEOUT = 45_000;
const DEFAULT_FETCH_IMAGE_TIMEOUT = 20_000;
const MAX_BASE64_LENGTH = 9_000_000;

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
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const image_base64 = body?.image_base64;
    if(!image_base64) return makeResponse(400, { error: 'No image_base64 provided' });
    if(typeof image_base64 !== 'string' || image_base64.length > MAX_BASE64_LENGTH){
      return makeResponse(400, { error: 'image_base64 invalid or too large', length: image_base64.length });
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if(!WORDWARE_API_KEY){
      console.error('[generate-lego] WORDWARE_API_KEY missing');
      return makeResponse(500, { error: 'WORDWARE_API_KEY missing in environment' });
    }

    const wordwareUrl = 'https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run';
    // prefer jpeg payload (our client resizes to jpeg)
    const dataUrlJpeg = `data:image/jpeg;base64,${image_base64}`;
    const payloadImageForm = { version: '^1.0', inputs: { photo: { type: 'image', image_url: dataUrlJpeg } } };
    const payloadFileForm = {
      version: '^1.0',
      inputs: {
        photo: {
          type: 'file',
          file_type: 'image/jpeg',
          file_name: `upload_${Date.now()}.jpg`,
          file_url: dataUrlJpeg
        }
      }
    };

    // helper to POST JSON and return { ok, status, text, json }
    async function postJson(payload){
      const opts = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WORDWARE_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'legoTechFest/1.0'
        },
        body: JSON.stringify(payload)
      };
      const res = await fetchWithTimeout(wordwareUrl, opts, DEFAULT_WORDWARE_TIMEOUT);
      const text = await res.text().catch(()=>null);
      let json = null;
      try{ json = text ? JSON.parse(text) : null } catch(e){ json = null; }
      return { ok: res.ok, status: res.status, text, json };
    }

    // Try the 'image' payload first (as your cURL example shows).
    // If we get 405 or other not-allowed, try the 'file' variant.
    let attemptResult = null;
    let attempts = 0;
    const maxAttempts = 2;
    // first try payloadImageForm; on 405 or 4xx/5xx do fallback to file form
    for(const attemptPayload of [payloadImageForm, payloadFileForm]){
      attempts++;
      try{
        console.log(`[generate-lego] Attempt ${attempts} sending payload type: ${attemptPayload.inputs.photo.type}`);
        const { ok, status, text, json } = await postJson(attemptPayload);
        console.log('[generate-lego] Wordware response status:', status);
        // If OK parse JSON shape and break
        if(ok){
          attemptResult = { status, json, rawText: text };
          break;
        } else {
          console.warn('[generate-lego] Wordware returned non-ok:', status, (text||''));
          // If 405 specifically, keep trying fallback payload.
          if(status === 405 && attemptPayload === payloadImageForm){
            // try next (file form)
            continue;
          }
          // If transient server error try again a bit (only for 5xx)
          if(status >= 500){
            if(attempts < maxAttempts) await sleep(800 * attempts);
            // if we were on image form, try file form next
            continue;
          }
          // for client errors other than 405, return the response so client can debug
          return makeResponse(status, { error: 'Wordware returned non-success', status, detail: text, json });
        }
      } catch (e){
        console.error('[generate-lego] fetch to Wordware failed on attempt', attempts, e?.message || e);
        if(attempts < maxAttempts) await sleep(800 * attempts);
        // Try next payload (if any)
        continue;
      }
    }

    if(!attemptResult){
      return makeResponse(502, { error: 'Wordware call failed after attempts' });
    }

    const data = attemptResult.json;
    if(!data){
      return makeResponse(500, { error: 'Invalid/empty JSON from Wordware', raw: attemptResult.rawText });
    }

    // Extract result_url or inline base64
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
      const dataUrl = `data:image/jpeg;base64,${inlineB64}`;
      return makeResponse(200, { result_url: resultUrl || null, data_url: dataUrl });
    }

    if(!resultUrl){
      console.error('[generate-lego] Unexpected Wordware response shape; sample:', JSON.stringify(data).slice(0,2000));
      return makeResponse(500, { error: 'Unexpected Wordware response structure', rawSample: data });
    }

    // fetch the image server-side and return as data_url
    try {
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
