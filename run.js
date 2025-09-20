const fs = require('fs');
const https = require('https');
const path = require('path');
const unzipper = require('unzipper');
const { spawn } = require('child_process');
const axios = require('axios');

const REPO = 'bigwayne/Discord-Media-Bot';
const BRANCH = 'master';
const CHECK_INTERVAL = 60 * 1000; // 60 seconds
const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`;
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits/${BRANCH}`;
const TEMP_DIR = './tmp_update';
const LAST_COMMIT_FILE = './.last_commit';
let botProcess = null;

function startBot() {
  console.log('▶️ Starting index.js...');
  botProcess = spawn('node', ['index.js'], { stdio: 'inherit' });
}

function stopBot() {
  if (botProcess) {
    console.log('🛑 Stopping index.js...');
    botProcess.kill();
  }
}

// get latest commit SHA
async function fetchLatestCommitSHA() {
  const response = await axios.get(COMMITS_API, {
    headers: { 'User-Agent': 'cicd-bot' }
  });
  return response.data.sha;
}

// download and extract ZIP
function downloadAndExtractZip() {
  return new Promise((resolve, reject) => {
    console.log('⬇️ Downloading latest version...');
    https.get(ZIP_URL, (res) => {
      res
        .pipe(unzipper.Extract({ path: TEMP_DIR }))
        .on('close', resolve)
        .on('error', reject);
    });
  });
}

// copy from temp folder to main directory
function copyFiles() {
  const extractedFolder = fs.readdirSync(TEMP_DIR).find(name => name.startsWith('Discord-Media-Bot-'));
  const extractedPath = path.join(TEMP_DIR, extractedFolder);

  const files = fs.readdirSync(extractedPath);
  for (const file of files) {
    if (['.env'].includes(file)) continue;

    const src = path.join(extractedPath, file);
    const dest = path.join('.', file);

    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }

    fs.cpSync(src, dest, { recursive: true });
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

function runNpmInstall() {
  return new Promise((resolve, reject) => {
    console.log('📦 Running npm install...');
    const install = spawn('npm', ['install'], { stdio: 'inherit' });

    install.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });
  });
}

// Load last known commit
function loadLastCommit() {
  if (!fs.existsSync(LAST_COMMIT_FILE)) return null;
  return fs.readFileSync(LAST_COMMIT_FILE, 'utf-8').trim();
}

// Save last commit SHA
function saveLastCommit(sha) {
  fs.writeFileSync(LAST_COMMIT_FILE, sha);
}

// Polling loop
async function checkForUpdates() {
  try {
    const latestSHA = await fetchLatestCommitSHA();
    const lastSHA = loadLastCommit();

    if (latestSHA !== lastSHA) {
      console.log(`🚨 New commit detected: ${latestSHA}`);
      stopBot();
      await downloadAndExtractZip();
      copyFiles();
      await runNpmInstall();
      saveLastCommit(latestSHA);
      startBot();
    } else {
      console.log('✅ No new commits.');
    }
  } catch (err) {
    console.error('❌ Update check failed:', err.message);
  }
}

// Start polling
startBot();
setInterval(checkForUpdates, CHECK_INTERVAL);