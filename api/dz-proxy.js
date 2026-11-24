export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawPath = typeof req.query?.path === 'string' ? req.query.path : '/chart/0/tracks?limit=25';
  const safePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  try {
    const upstream = await fetch(`https://api.deezer.com${safePath}`, {
      headers: {
        'User-Agent': 'pMusic-Web/0.15.0',
        Accept: 'application/json',
      },
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(upstream.status).send(text);
  } catch (err) {
    return res.status(502).json({
      error: 'deezer_proxy_error',
      message: err instanceof Error ? err.message : 'Upstream failed',
      data: [],
    });
  }
}
