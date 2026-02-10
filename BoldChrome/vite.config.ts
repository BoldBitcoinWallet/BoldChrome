import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
	plugins: [
		wasm(),
		topLevelAwait(),
		sveltekit()
	],
	build: {
		// Optimize for Chrome extension
		rollupOptions: {
			output: {
				// Prevent code splitting for extension compatibility
				inlineDynamicImports: false
			}
		},
		// Source maps for debugging
		sourcemap: process.env.NODE_ENV === 'development',
		minify: process.env.NODE_ENV === 'production'
	},
	server: {
		// Development server settings
		port: 5173,
		strictPort: false
	}
});
