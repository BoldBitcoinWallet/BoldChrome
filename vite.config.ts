import { sveltekit } from '@sveltejs/kit/vite';
<<<<<<< HEAD
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

/**
 * Compiles src/background.ts into build/background.js as a separate
 * ES module after the main SvelteKit bundle finishes.
 */
function buildBackgroundScript(): Plugin {
	let buildMode = 'development';
	return {
		name: 'build-background-script',
		apply: 'build',
		config(_config, env) {
			buildMode = env.mode;
		},
		closeBundle: async () => {
			await viteBuild({
				configFile: false,
				build: {
					lib: {
						entry: path.resolve('./src/background.ts'),
						formats: ['es'],
						fileName: () => 'background.js'
					},
					outDir: 'build',
					emptyOutDir: false,
					sourcemap: buildMode === 'development',
					minify: buildMode === 'production' ? 'esbuild' : false
				},
				logLevel: 'warn'
			});
		}
	};
}
=======
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
>>>>>>> origin/main

export default defineConfig({
	plugins: [
		wasm(),
		topLevelAwait(),
<<<<<<< HEAD
		sveltekit(),
		buildBackgroundScript()
=======
		sveltekit()
>>>>>>> origin/main
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
