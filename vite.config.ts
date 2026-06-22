import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';

/** Recursively collect all .ts source files (excluding tests) */
function collectEntries(dir: string, base: string = dir): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      Object.assign(entries, collectEntries(full, base));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      const rel = full.slice(resolve(base).length + 1).replace(/\.ts$/, '');
      entries[rel] = full;
    }
  }
  return entries;
}


const entries = collectEntries(resolve(__dirname, 'src'));

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      outDir: 'dist',
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    lib: {
      entry: entries,
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'redux',
        'redux-saga',
        'redux-saga/effects',
        'typed-redux-saga',
        'typed-redux-saga/macro',
        'fast-equals',
        'kefir',
        '@preact/signals-react',
        '@preact/signals-react/runtime',
        '@preact/signals-core',
        'react',
        'use-sync-external-store',
        'svelte',
        /^react\//,
        /^use-sync-external-store\//,
        /^svelte\//,
        /^redux-saga\//,
        /^typed-redux-saga\//,
      ],
      output: {
        format: 'es',
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
    minify: false,
    sourcemap: true,
  },
});

