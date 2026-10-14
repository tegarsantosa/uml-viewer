import { defineConfig, loadEnv } from 'vite';

// Hosts that may reach the dev/preview server besides localhost.
// Add more with ALLOWED_HOSTS="my.host.com,.example.org" (leading dot = all subdomains)
// or set ALLOWED_HOSTS=all to disable the check entirely.
const DEFAULT_HOSTS = ['localhost'];

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const extra = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const allowedHosts: true | string[] = extra.includes('all') ? true : [...DEFAULT_HOSTS, ...extra];
  const host = env.HOST === 'true' || env.HOST === '1' ? true : env.HOST || undefined;

  return {
    server: { allowedHosts, host },
    preview: { allowedHosts, host },
  };
});
