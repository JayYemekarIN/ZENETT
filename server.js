require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const { VC_URL, BOT_NAME } = process.env;
const ANIME_PAHE_BASE = "https://animepahe.si/"; 
const CLI_FILENAME = "animepahe-cli-beta.exe"; 

if (!VC_URL) {
    console.error("❌ ERROR: VC_URL is missing in .env file!");
    process.exit(1);
}

puppeteer.use(StealthPlugin());
const delay = (ms) => new Promise(res => setTimeout(res, ms));

(async () => {
    console.log(`🚀 Starting ${BOT_NAME} (Dynamic Chat Fix)...`);

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: "./zenett_session",
        args: [
            '--start-fullscreen',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--disable-features=AudioServiceOutOfProcess', 
            '--force-wave-audio', 
        ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000); 

    // ==========================================
    // 1. STARTUP: LOGIN & CHAT ONLY
    // ==========================================
    console.log("🔑 Logging in...");
    await page.goto(VC_URL, { waitUntil: 'domcontentloaded' });
    
    // Wait for basic UI to load
    await delay(5000);

    // 🟢 FIXED: Robust Dynamic Chat Logic
    console.log("💬 Checking Chat...");
    try {
        // 1. Check if chat is ALREADY open (Look for the text input box)
        const chatInput = await page.$('div[class*="channelTextArea"]'); 

        if (chatInput) {
            console.log("✅ Chat is already open.");
        } else {
            console.log("   -> Chat closed. Searching for dynamic button...");
            
            // 2. Dynamic Search: Find button STARTING WITH "Show Chat"
            // The ^ symbol means "starts with". This matches:
            // "Show Chat"
            // "Show Chat, 1 new message"
            // "Show Chat, 2 mentions, unread"
            const chatBtn = await page.waitForSelector('button[aria-label^="Show Chat"]', { timeout: 5000 });
            
            if (chatBtn) {
                await chatBtn.click();
                console.log("✅ Clicked 'Show Chat'!");
            } else {
                console.log("⚠️ Chat button not found (Selector mismatch).");
            }
        }
    } catch(e) { 
        console.log("⚠️ Chat Error:", e.message); 
    }

    // State Tracking
    let isConnected = false;
    let videoTab = null;

    // ==========================================
    // 2. HELPER: JOIN & STREAM
    // ==========================================
    async function joinVoiceAndStream() {
        if (isConnected) return; 

        console.log("🚀 'Play' received. Joining Voice Channel...");
        
        try {
            // HUNTER JOIN LOGIC (Find "Join Voice" text)
            const joined = await page.evaluate(() => {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'));
                const target = allButtons.find(btn => btn.innerText && btn.innerText.includes("Join Voice"));
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            });

            if (joined) {
                console.log("✅ Joined Voice!");
                await delay(2000);
            } else {
                console.log("⚠️ 'Join Voice' button not found. Assuming already connected.");
            }

            // DEAFEN
            try {
                const deafenBtn = await page.$('button[aria-label="Deafen"]');
                if (deafenBtn) await deafenBtn.click();
            } catch(e) {}

            // START STREAM
            console.log("🎥 Starting Stream...");
            try {
                const shareBtn = await page.waitForSelector('button[aria-label*="Share"]', { timeout: 3000 });
                if (shareBtn) {
                    await shareBtn.click();
                    console.log("👉 ACTION: Select 'Entire Screen' -> 'Go Live'");
                    await delay(5000); 
                }
            } catch(e) {
                console.log("⚠️ Could not auto-click Share (maybe already streaming).");
            }

            isConnected = true;

        } catch (e) {
            console.log(`❌ Join Failed: ${e.message}`);
        }
    }

    // ==========================================
    // 3. HELPER: LEAVE VOICE (Quit Video -> Disconnect)
    // ==========================================
    async function leaveVoice() {
        console.log("🛑 Stop command received.");
        
        // 1. QUIT VIDEO FIRST (Kill the tab)
        if (videoTab) {
            try {
                await videoTab.close();
                videoTab = null;
                console.log("🗑️ Video tab closed (Audio Stopped).");
            } catch (e) {
                console.log("⚠️ Error closing tab:", e.message);
            }
        }

        // 2. DISCONNECT
        console.log("🔌 Disconnecting...");
        try {
            // Find Red Phone Button
            const disconnectBtn = await page.waitForSelector('button[aria-label="Disconnect"]', { timeout: 5000 });
            if (disconnectBtn) {
                await disconnectBtn.click();
                console.log("✅ Disconnected.");
            } else {
                console.log("⚠️ Disconnect button not found.");
            }
            
            isConnected = false;
            
        } catch (e) {
            console.log(`⚠️ Error disconnecting: ${e.message}`);
        }
    }

    // ==========================================
    // 4. HELPER: CLI EXTRACTION
    // ==========================================
    function getDirectLinkFromCLI(uuidUrl, episode) {
        return new Promise((resolve, reject) => {
            const exePath = path.join(__dirname, CLI_FILENAME);
            const outputFilename = 'stream_link.txt';
            const command = `"${exePath}" -l "${uuidUrl}" -e ${episode} -x -f "${outputFilename}"`;
            
            console.log(`💻 Executing: ${command}`);

            exec(command, { cwd: __dirname }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`❌ CLI Error: ${error.message}`);
                    return reject(error);
                }
                const fullOutputPath = path.join(__dirname, outputFilename);
                try {
                    if (fs.existsSync(fullOutputPath)) {
                        const link = fs.readFileSync(fullOutputPath, 'utf8').trim();
                        fs.unlinkSync(fullOutputPath);
                        resolve(link);
                    } else {
                        reject(new Error("Link file missing."));
                    }
                } catch (err) { reject(err); }
            });
        });
    }

    // ==========================================
    // 5. MAIN PLAY LOGIC
    // ==========================================
    async function playAnime(query, epNumber) {
        // Ensure connection
        await joinVoiceAndStream();

        console.log(`🔍 [DEBUG] Searching for "${query}"...`);
        
        if (videoTab) { try { await videoTab.close(); } catch (e) {} }
        videoTab = await browser.newPage();
        videoTab.setDefaultNavigationTimeout(60000);

        try {
            await videoTab.goto(ANIME_PAHE_BASE, { waitUntil: 'domcontentloaded' });
            
            const searchInput = 'input[name="q"]';
            await videoTab.waitForSelector(searchInput, { visible: true });
            await videoTab.type(searchInput, query, { delay: 100 });
            
            const firstResult = '.search-results a';
            await videoTab.waitForSelector(firstResult, { visible: true, timeout: 10000 });
            await videoTab.click(firstResult);
            
            await videoTab.waitForFunction(() => document.URL.includes('/anime/'), { timeout: 30000 });
            const uuidUrl = videoTab.url();
            console.log(`✅ [DEBUG] Found UUID: ${uuidUrl}`);

            console.log("⚙️ [DEBUG] Extracting Link...");
            const streamLink = await getDirectLinkFromCLI(uuidUrl, epNumber);
            console.log(`💎 [DEBUG] Link Found!`);

            console.log("📺 [DEBUG] Injecting Player...");
            const playerHtml = `
                <html>
                    <body style="background-color: black; margin: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh;">
                        <video id="zenettPlayer" controls autoplay style="width: 100%; height: 100vh;">
                            <source src="${streamLink}" type="video/mp4">
                        </video>
                    </body>
                </html>
            `;
            await videoTab.setContent(playerHtml);
            
            await delay(2000);
            await videoTab.evaluate(() => {
                const v = document.getElementById('zenettPlayer');
                if (v) v.requestFullscreen().catch(err => console.error("FS Error:", err));
            });

            console.log("✅ [SUCCESS] Now Playing!");

        } catch (e) {
            console.error(`❌ [FAILURE]: ${e.message}`);
        }
    }

    // Media Controls
    async function pauseVideo() {
        if (videoTab && !videoTab.isClosed()) {
            console.log("⏸️ Pausing...");
            await videoTab.evaluate(() => {
                const v = document.getElementById('zenettPlayer');
                if (v) v.pause();
            });
        }
    }

    async function resumeVideo() {
        if (videoTab && !videoTab.isClosed()) {
            console.log("▶️ Resuming...");
            await videoTab.evaluate(() => {
                const v = document.getElementById('zenettPlayer');
                if (v) v.play();
            });
        }
    }

    // ==========================================
    // 6. MONITORING LOOP
    // ==========================================
    // Capture history to ignore
    let lastMsg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="messageContent"]');
        return msgs.length ? msgs[msgs.length - 1].innerText : "";
    });

    console.log(`🛡️ History ignored. Waiting for NEW commands...`);

    while (true) {
        try {
            const current = await page.evaluate((bot) => {
                const msgs = document.querySelectorAll('[class*="messageContent"]');
                return msgs.length ? msgs[msgs.length - 1].innerText : null;
            }, BOT_NAME);

            if (current && current !== lastMsg) {
                lastMsg = current;
                if (current.toLowerCase().includes(`@${BOT_NAME.toLowerCase()}`)) {
                    console.log(`📩 NEW Command: "${current}"`);
                    const lowerCmd = current.toLowerCase();

                    if (lowerCmd.includes("play")) {
                        const match = current.match(/play\s+(.+)\s+(\d+)/i);
                        if (match) await playAnime(match[1].trim(), match[2].trim());
                    } 
                    else if (lowerCmd.includes("pause")) await pauseVideo();
                    else if (lowerCmd.includes("start") || lowerCmd.includes("resume")) await resumeVideo();
                    else if (lowerCmd.includes("stop") || lowerCmd.includes("disconnect")) await leaveVoice();
                }
            }
        } catch (e) {}
        await delay(2000); 
    }
})();