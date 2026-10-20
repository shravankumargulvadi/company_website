import { defineConfig } from 'astro/config';

/** GitHub Pages project path; set to '/' once the site moves to its own domain. */
const base = '/company_website';

export default defineConfig({
  site: 'https://shravankumargulvadi.github.io',
  base,
  trailingSlash: 'ignore',
  redirects: {
    '/candidate-a': `${base}/`,
    '/candidate-c': `${base}/`,
  },
});
