// URL-safe bearer token for public share links (base64url, 128-bit entropy).
// btoa is available on Cloudflare Workers. 16 bytes -> 22 chars.
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
