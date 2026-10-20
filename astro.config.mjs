import { defineConfig } from 'astro/config';

export default defineConfig({
  trailingSlash: 'ignore',
  redirects: {
    '/candidate-a': '/',
    '/candidate-c': '/',
  },
});
