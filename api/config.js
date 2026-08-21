// Vercel serverless route — public client configuration.
// Exposes only values that are safe in the browser (the Maps JS key is
// meant to be referrer-restricted in the Google Cloud console).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300');
  return res.status(200).json({
    googleMapsKey: process.env.GOOGLE_MAPS_KEY || '',
  });
}
