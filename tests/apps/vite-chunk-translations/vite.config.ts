import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { vite as gtCompiler } from '@generaltranslation/compiler';
import { defineConfig } from 'vite';
import { collectMessages } from './scripts/collectMessages.mjs';

// GT_CHUNK_TRANSLATIONS=true turns the feature on; scripts/check.mjs builds
// the app both ways. CHECK_MESSAGES is set by scripts/pseudo-translate.mjs,
// which reads the app's messages from a build.
const messagesFile = process.env.CHECK_MESSAGES;

// Where the translation files are: the compiler reads them there, and so
// does the app's own loadTranslations. scripts/check.mjs builds the app once
// more from a copy with a changed translation.
const translations = process.env.CHECK_TRANSLATIONS ?? resolve('src/_gt');

export default defineConfig({
  plugins: [
    gtCompiler({
      _debugHashManifest: messagesFile !== undefined,
      files: { gt: { output: `${translations}/[locale].json` } },
    }),
    react(),
    messagesFile !== undefined && collectMessages(messagesFile),
  ],
  resolve: {
    // pnpm installs gt-react's React peer into the workspace package, so its
    // imports can resolve a separate copy; bundle only the app's copy.
    dedupe: ['react', 'react-dom'],
    alias: { '@translations': translations },
  },
  // scripts/check.mjs builds pages/nested.html with a relative base
  base: process.env.CHECK_BASE,
  build: {
    outDir: process.env.CHECK_OUT_DIR ?? 'dist',
    // plain.html is the app without messages that are not split by chunk
    rollupOptions: { input: process.env.CHECK_ENTRY ?? 'index.html' },
  },
});
