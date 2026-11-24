export default function handler(_req, res) {
  res.status(200).json({ ok: true, app: 'pMusic', version: '0.15.0' });
}
