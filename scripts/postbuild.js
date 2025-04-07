#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Construct the path to the target file relative to the script's location
const targetFile = path.resolve(__dirname, '../build/index.js');

try {
  if (fs.existsSync(targetFile)) {
    fs.chmodSync(targetFile, '755');
    console.info(`Successfully set executable permission on ${targetFile}`); // Changed log to info
  } else {
    console.warn(`Warning: ${targetFile} not found. Skipping chmod.`);
  }
} catch (error) {
  console.error(`Error setting executable permission on ${targetFile}:`, error);
  process.exit(1); // Exit with error code if chmod fails
}
