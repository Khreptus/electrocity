// Адреса сервера Electrocity (Cloudflare Worker). На самому сервері — відносний шлях.
export const API = /\.workers\.dev$/.test(location.hostname) ? '/' : 'https://electrocity.slv463991.workers.dev/';
export const API_READY = !API.includes('REPLACE_');
