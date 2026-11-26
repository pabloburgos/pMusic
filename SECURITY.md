# Security Policy

## Supported Versions

Only the latest minor release line (`0.23.x`) receives security updates and OTA patches.

| Version | Supported |
| :--- | :--- |
| `0.23.x` | Yes |
| `< 0.23.0` | No |

## Reporting a Vulnerability

If you discover a security issue (such as credential leakage, OAuth flow bypass, unsafe Android WebView bridge exposure, or Supabase RLS misconfiguration):

1. **Do not** open a public GitHub issue with exploit details.
2. Report it privately through **GitHub Security Advisories** (**Security → Advisories → Report a vulnerability**) on this repository, or contact the maintainer directly.
3. Include clear reproduction steps, affected files/versions, and potential impact.

## Secret Hygiene

- Never commit `.env` files, personal access tokens, OAuth client secrets, or Android release keystores.
- Only public anonymous client keys protected by Supabase Row Level Security (`RLS`) policies are safe to ship in client bundles.
