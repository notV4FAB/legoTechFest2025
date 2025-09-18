import fetch from 'node-fetch';

export async function handler(event, context) {
  try {
    const { image_base64 } = JSON.parse(event.body);
    if (!image_base64) return { statusCode: 400, body: 'No image provided' };

    // Usamos la API Key de Wordware desde Netlify Secrets
    const WORDWARE_API_KEY = process.env.WORDWARE_API_KEY;
    if (!WORDWARE_API_KEY) return { statusCode: 500, body: 'API key missing' };

    const response = await fetch('https://app.wordware.ai/api/released-app/a26f58c9-f5a6-4f3b-86f1-c5f934fc75b6/run', {
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

    if (!response.ok) return { statusCode: response.status, body: 'Wordware API error' };
    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ result_url: data.output_image_url }) // ajustá según la respuesta real de Wordware
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
