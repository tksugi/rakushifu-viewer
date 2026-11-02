import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend', import.meta.url)) } },
  base: '/static/react/',
  build: {
    outDir: 'static/react',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      // This is a browser-only bundle; Arc and React Query also support RSC.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      },
      input: 'frontend/main.tsx',
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'style.css' : '[name]-[hash][extname]',
      },
    },
  },
});
