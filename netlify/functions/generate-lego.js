// /.netlify/functions/generate-lego.js
'use strict';

import { blobs } from '@netlify/blobs';
import fetch from 'node-fetch';

export async function handler(event) {
  try {
    const { image_base64 } = JSON.parse(event.body || '{}');
    if (!image_base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
    }

    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'API key missing' }) };
    }

    // 1. Subir imagen a Netlify Blobs
    const store = blobs();
    const buffer = Buffer.from(image_base64, 'base64');
    const key = `lego-uploads/${Date.now()}.jpg`;

    const { url: fileUrl } = await store.set(key, buffer, {
      contentType: 'image/jpeg',
      addRandomSuffix: true, // evita colisiones
    });

    // 2. Llamar a Wordware con URL pública
    const payload = {
      version: '^1.0',
      inputs: {
        photo: {
          type: 'file',
          file_type: 'image/jpeg',
          file_name: key.split('/').pop(),
          file_url: fileUrl, // URL accesible por Wordware
        },
      },
    };

    const resp = await fetch(
      'https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WORDWARE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await resp.text();
    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: text }) };
    }

    // 3. Parsear salida (Wordware usa streaming NDJSON)
    let resultUrl = null;
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj?.value?.output?.image_url) {
          resultUrl = obj.value.output.image_url;
        }
        if (obj?.value?.outputs?.photo?.image_url) {
          resultUrl = obj.value.outputs.photo.image_url;
        }
      } catch {
        // ignorar líneas que no sean JSON
      }
    }

    if (!resultUrl) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'No result_url found', raw: text }),
      };
    }

    // 4. Descargar imagen generada y devolver base64
    const imgResp = await fetch(resultUrl);
    const arrBuf = await imgResp.arrayBuffer();
    const b64 = Buffer.from(arrBuf).toString('base64');
    const dataUrl = `data:${imgResp.headers.get('content-type') || 'image/png'};base64,${b64}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ result_url: resultUrl, data_url: dataUrl }),
    };
  } catch (err) {
    console.error('[generate-lego] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
