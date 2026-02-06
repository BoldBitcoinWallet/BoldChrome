#!/usr/bin/env node

/**
 * BoldChrome Setup Verification Script
 * 
 * This script verifies that your development environment is properly configured
 * for building and testing the BoldChrome Chrome extension.
 */

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, description) {
  const exists = fs.existsSync(filePath);
  const status = exists ? '✓' : '✗';
  const color = exists ? 'green' : 'red';
  log(`  ${status} ${description}`, color);
  return exists;
}

function checkEnvVariable(key) {
  const value = process.env[key];
  const exists = !!value;
  const status = exists ? '✓' : '✗';
  const color = exists ? 'green' : 'yellow';
  const displayValue = exists ? value.substring(0, 20) + '...' : 'NOT SET';
  log(`  ${status} ${key} = ${displayValue}`, color);
  return exists;
}

log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
log('║         BoldChrome Setup Verification Script                  ║', 'cyan');
log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');

let allChecks = true;

// Check 1: File Structure
log('1. File Structure', 'blue');
allChecks &= checkFile('package.json', 'package.json exists');
allChecks &= checkFile('svelte.config.js', 'svelte.config.js exists');
allChecks &= checkFile('vite.config.ts', 'vite.config.ts exists');
allChecks &= checkFile('tsconfig.json', 'tsconfig.json exists');
allChecks &= checkFile('.env.local', '.env.local exists (for development)');
allChecks &= checkFile('.env.example', '.env.example exists (template)');
allChecks &= checkFile('static/manifest.json', 'Chrome manifest.json exists');
log('');

// Check 2: Source Code Structure
log('2. Source Code Structure', 'blue');
allChecks &= checkFile('src/routes/popup/+page.svelte', 'Popup UI component');
allChecks &= checkFile('src/routes/popup/page.ts', 'Popup logic file');
allChecks &= checkFile('src/lib/stores/index.ts', 'Svelte stores');
log('');

// Check 3: Dependencies
log('3. Dependencies', 'blue');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const requiredDeps = [
  'sveltekit-adapter-chrome-extension'
];

const requiredDevDeps = [
  '@sveltejs/kit',
  '@sveltejs/vite-plugin-svelte',
  'svelte',
  'typescript',
  'vite'
];

let depsOk = true;
for (const dep of requiredDeps) {
  const exists = packageJson.dependencies && packageJson.dependencies[dep];
  const status = exists ? '✓' : '✗';
  const color = exists ? 'green' : 'red';
  log(`  ${status} ${dep}`, color);
  depsOk &= !!exists;
}

for (const dep of requiredDevDeps) {
  const exists = packageJson.devDependencies && packageJson.devDependencies[dep];
  const status = exists ? '✓' : '✗';
  const color = exists ? 'green' : 'red';
  log(`  ${status} ${dep} (dev)`, color);
  depsOk &= !!exists;
}

allChecks &= depsOk;
log('');

// Check 4: Environment Variables
log('4. Environment Configuration', 'blue');
const envExists = fs.existsSync('.env.local');
if (envExists) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const hasKeyLine = envContent.includes('PUBLIC_GOOGLE_API_KEY=');
  const apiKeySet = hasKeyLine && envContent.split('\n').some(line => line.startsWith('PUBLIC_GOOGLE_API_KEY=') && line.split('=')[1]?.trim());

  const status = apiKeySet ? '✓' : (hasKeyLine ? '⚠' : '✗');
  const color = apiKeySet ? 'green' : (hasKeyLine ? 'yellow' : 'red');
  log(`  ${status} .env.local is configured`, color);

  if (!apiKeySet) {
    log(`     ⚠ PUBLIC_GOOGLE_API_KEY is not set or empty. Get one from https://ai.google.dev`, 'yellow');
    allChecks = false;
  }
} else {
  log('  ✗ .env.local not found', 'red');
  log('     Run: cp .env.example .env.local', 'yellow');
  allChecks = false;
}
log('');

// Check 5: npm/pnpm
log('5. Package Manager', 'blue');
const hasPnpm = fs.existsSync('pnpm-lock.yaml');
const hasNpm = fs.existsSync('package-lock.json');
const hasYarn = fs.existsSync('yarn.lock');

if (hasPnpm) {
  log('  ✓ pnpm detected', 'green');
} else if (hasNpm) {
  log('  ✓ npm detected', 'green');
} else if (hasYarn) {
  log('  ✓ yarn detected', 'green');
} else {
  log('  ✗ No package manager lock file found', 'red');
  log('     Run: pnpm install (or npm install)', 'yellow');
  allChecks = false;
}

const nodeModulesExists = fs.existsSync('node_modules');
if (nodeModulesExists) {
  log('  ✓ node_modules installed', 'green');
} else {
  log('  ✗ node_modules not found', 'red');
  log('     Run: pnpm install (or npm install)', 'yellow');
  allChecks = false;
}
log('');

// Check 6: Build Directory
log('6. Build Output', 'blue');
const buildExists = fs.existsSync('build');
if (buildExists) {
  log('  ✓ /build directory exists', 'green');
  const manifestExists = fs.existsSync('build/manifest.json');
  if (manifestExists) {
    log('  ✓ manifest.json in /build', 'green');
  } else {
    log('  ⚠ manifest.json not found in /build', 'yellow');
    log('     Run: pnpm run build', 'yellow');
  }
} else {
  log('  ⚠ /build directory not created yet', 'yellow');
  log('     Run: pnpm run build', 'yellow');
}
log('');

// Summary
log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
if (allChecks) {
  log('║          ✓ All checks passed! Ready to develop.              ║', 'green');
  log('║                                                              ║', 'cyan');
  log('║  Next steps:                                                 ║', 'cyan');
  log('║  1. Run: pnpm run build                                      ║', 'cyan');
  log('║  2. Go to chrome://extensions                                ║', 'cyan');
  log('║  3. Enable "Developer mode"                                  ║', 'cyan');
  log('║  4. Click "Load unpacked" and select /build                  ║', 'cyan');
  log('║  5. Test on a Medium article                                 ║', 'cyan');
} else {
  log('║          ✗ Some checks failed. See issues above.             ║', 'red');
  log('║                                                              ║', 'cyan');
  log('║  Fix the issues above and run this script again.             ║', 'cyan');
}
log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');

process.exit(allChecks ? 0 : 1);
