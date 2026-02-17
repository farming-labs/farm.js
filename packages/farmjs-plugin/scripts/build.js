#!/usr/bin/env node
// Simple build script to copy ESM files with proper extension

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

// The TypeScript compiler outputs to dist/ with .js extension
// We need to create .mjs versions for ESM exports

console.log('Post-processing build output...');

// Nothing to do for now - TypeScript handles ESM output
console.log('Build complete!');
