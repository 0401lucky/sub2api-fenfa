export function resolveAppUrl(baseUrl: string, relativePath: string): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return new URL(normalizedPath, normalizedBase);
}
