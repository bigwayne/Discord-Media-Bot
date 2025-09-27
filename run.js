require('dotenv').config();
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { execSync, spawn } = require('child_process');
const axios = require('axios');

const REPO = 'bigwayne/Discord-Media-Bot';
const BRANCH = 'master';
const POLL_INTERVAL = process.env.GITHUB_POLL_INTERVAL || 60 * 1000 // 60 seconds
const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`;
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits/${BRANCH}`;
const TEMP_DIR = './tmp_update';
const LAST_COMMIT_FILE = './.last_commit';
let botProcess = null;

function startBot() {
    console.log('▶️  Starting index.js...');
    botProcess = spawn('node', ['index.js'], { stdio: 'inherit' });
}

function stopBot() {
    if (botProcess) {
        console.log('🛑  Stopping index.js...');
        botProcess.kill();
        botProcess = null;
    }
}

// safely delete .last_commit file with error handling
function deleteLastCommitFile() {
    try {
        if (fs.existsSync(LAST_COMMIT_FILE)) {
            fs.unlinkSync(LAST_COMMIT_FILE);
            console.log('🗑️  Deleted .last_commit file for fresh start on next run');
        }
    } catch (err) {
        console.error('⚠️  Failed to delete .last_commit file:', err.message);
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
async function downloadAndExtractZip() {
    console.log('⬇️  Downloading latest version...');

    const response = await axios.get(ZIP_URL, { responseType: 'stream' });

    await new Promise((resolve, reject) => {
        response.data
            .pipe(unzipper.Extract({ path: TEMP_DIR }))
            .on('close', resolve)
            .on('error', reject);
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
        console.log('📦  Running npm install...');

        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const install = spawn(npmCmd, ['install'], { stdio: 'inherit' });

        install.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`npm install failed with code ${code}`));
            }
        });

        install.on('error', (err) => {
            reject(new Error(`Failed to start npm install: ${err.message}`));
        });
    });
}

// load last known commit
function loadLastCommit() {
    if (!fs.existsSync(LAST_COMMIT_FILE)) return null;
    return fs.readFileSync(LAST_COMMIT_FILE, 'utf-8').trim();
}

// save last commit SHA
function saveLastCommit(sha) {
    fs.writeFileSync(LAST_COMMIT_FILE, sha);
}

// polling loop
async function checkForUpdates() {
    try {
        // Get current Git branch
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

        if (currentBranch !== 'master') {
            console.log(`😎  Skipping update — current branch is '${currentBranch}', not 'master'.`);
            return;
        }

        const latestSHA = await fetchLatestCommitSHA();
        const lastSHA = loadLastCommit();
        const isFirstRun = !lastSHA;

        if (isFirstRun || latestSHA !== lastSHA) {
            console.log(isFirstRun ? '🏃  First-time setup — pulling latest code...' : `🚨  New commit detected: ${latestSHA}`);

            stopBot();
            await downloadAndExtractZip();
            copyFiles();
            await runNpmInstall();
            saveLastCommit(latestSHA);
            if (isFirstRun) {
                console.log(`🚨  Remember to Add your Discord App to your Server! https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=bot&permissions=268446752`)
            }
            startBot();
        } else {
            console.log('😴  No new commits.');
        }
    } catch (err) {
        console.error('❌  Update check failed:', err.message);
    }
}

function cleanupAndExit() {
    console.log('\n👋  Shutting down...');
    stopBot();
    deleteLastCommitFile(); // delete .last_commit to force fresh download on next start
    process.exit();
}

// handle multiple shutdown signals and ensure cleanup only runs once
let shutdownInProgress = false;
function handleShutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`\n📡  Received ${signal}`);
    cleanupAndExit();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => handleShutdown('SIGTERM')); // Termination (e.g. kill)
process.on('exit', () => {
    if (!shutdownInProgress) {
        stopBot();
        deleteLastCommitFile();
    }
});

// handle uncaught exceptions to ensure cleanup
process.on('uncaughtException', (err) => {
    console.error('💥  Uncaught exception:', err);
    cleanupAndExit();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥  Unhandled rejection at:', promise, 'reason:', reason);
    cleanupAndExit();
});

// run an initial check before starting the bot
(async () => {
    await checkForUpdates();
    console.log(`⏱️  Polling for code changes every ${POLL_INTERVAL / 1000} seconds.`);
    setInterval(checkForUpdates, POLL_INTERVAL);
})();