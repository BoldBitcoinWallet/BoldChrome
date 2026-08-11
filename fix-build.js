#!/usr/bin/env node
/**
 * Post-build script for Chrome extension HTML files.
 * Ensures emitted CSS assets are linked in popup entry documents.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildDir = path.join(__dirname, 'build');

function findBaseCSSFile() {
  const assetsDir = path.join(buildDir, 'app/immutable/assets');
  const files = fs.readdirSync(assetsDir);
  const cssFile = files.find(f => f.match(/^2\.[a-zA-Z0-9]+\.css$/));
  return cssFile ? `/app/immutable/assets/${cssFile}` : null;
}

function findAllAssetCSSFiles() {
  const assetsDir = path.join(buildDir, 'app/immutable/assets');
  if (!fs.existsSync(assetsDir)) return [];
  const files = fs
    .readdirSync(assetsDir)
    .filter(f => f.endsWith('.css'))
    .sort();
  return files.map(f => `/app/immutable/assets/${f}`);
}

function fixHTMLFile(filePath) {
  const baseCssPath = '/app.css';
  const assetCssPaths = findAllAssetCSSFiles();

  let content = fs.readFileSync(filePath, 'utf8');

  // Chrome extension pages can emit noisy preload mismatch warnings for preload/modulepreload.
  // These links are optional because scripts are imported directly by the runtime bootstrap.
  const modulePreloadRegex = /<link\b[^>]*\brel="modulepreload"[^>]*>\s*/gi;
  const jsPreloadRegex = /<link\b[^>]*\brel="preload"[^>]*\bhref="\/app\/immutable\/[^\"]+\.js"[^>]*>\s*/gi;
  const modulePreloadMatches = content.match(modulePreloadRegex) || [];
  const jsPreloadMatches = content.match(jsPreloadRegex) || [];
  if (modulePreloadMatches.length > 0) {
    content = content.replace(modulePreloadRegex, '');
    console.log(`${path.basename(filePath)}: Removed ${modulePreloadMatches.length} modulepreload link(s)`);
  }
  if (jsPreloadMatches.length > 0) {
    content = content.replace(jsPreloadRegex, '');
    console.log(`${path.basename(filePath)}: Removed ${jsPreloadMatches.length} JS preload link(s)`);
  }

  const hasAnyStylesheet = content.includes('rel="stylesheet"');
  const hasBaseCss = content.includes(`href="${baseCssPath}"`);

  if (!hasBaseCss) {
    const baseLink = `\n\t\t<link rel="stylesheet" href="${baseCssPath}" />`;
    content = content.replace('</head>', `${baseLink}\n\t</head>`);
    console.log(`${path.basename(filePath)}: Added base stylesheet ${baseCssPath}`);
  }

  if (assetCssPaths.length > 0) {
    const missingAssetLinks = assetCssPaths
      .filter((href) => !content.includes(`href="${href}"`))
      .map((href) => `\t\t<link rel="stylesheet" href="${href}" />`)
      .join('\n');

    if (missingAssetLinks) {
      content = content.replace('</head>', `${missingAssetLinks}\n\t</head>`);
      console.log(`${path.basename(filePath)}: Added ${assetCssPaths.length} hashed CSS asset link(s)`);
    } else {
      console.log(`${path.basename(filePath)}: Hashed CSS asset links already present`);
    }
  } else if (!hasAnyStylesheet) {
    const fallbackCssPath = findBaseCSSFile();
    if (fallbackCssPath) {
      const fallbackLink = `\n\t\t<link rel="stylesheet" href="${fallbackCssPath}" />`;
      content = content.replace('</head>', `${fallbackLink}\n\t</head>`);
      console.log(`${path.basename(filePath)}: Added fallback stylesheet ${fallbackCssPath}`);
    } else {
      console.warn(`${path.basename(filePath)}: No emitted CSS assets found`);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`${path.basename(filePath)}: CSS links verified`);
}

// Fix both index.html and popup.html
const htmlFiles = ['index.html', 'popup.html'];
htmlFiles.forEach(file => {
  const filePath = path.join(buildDir, file);
  if (fs.existsSync(filePath)) {
    fixHTMLFile(filePath);
  }
});

console.log('Build fix complete!');
