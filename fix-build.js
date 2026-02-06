#!/usr/bin/env node
/**
 * Post-build script to fix Chrome extension HTML files
 * Adds CSS links that are missing after the build process
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildDir = path.join(__dirname, 'build');

function findCSSFile() {
  const assetsDir = path.join(buildDir, 'app/immutable/assets');
  const files = fs.readdirSync(assetsDir);
  const cssFile = files.find(f => f.match(/^2\.[a-zA-Z0-9]+\.css$/));
  return cssFile ? `/app/immutable/assets/${cssFile}` : null;
}

function fixHTMLFile(filePath) {
  const cssPath = findCSSFile();
  if (!cssPath) {
    console.warn('CSS file not found!');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix the inline body style background to white
  content = content.replace(
    /background:\s*(?:#f6f7fb|linear-gradient\([^)]+\));/g,
    'background: #ffffff;'
  );

  // Check if CSS is already linked
  if (!content.includes('rel="stylesheet"')) {
    // Add CSS link after the inline style tag
    const cssLink = `<link rel="stylesheet" href="${cssPath}">`;
    
    // Try to insert after </style>
    if (content.includes('</style>')) {
      content = content.replace(
        '</style>',
        `</style>\n\t\t${cssLink}`
      );
      console.log(`${path.basename(filePath)}: Added CSS link ${cssPath}`);
    }
  } else {
    console.log(`${path.basename(filePath)}: CSS already linked`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`${path.basename(filePath)}: Fixed background color`);
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
