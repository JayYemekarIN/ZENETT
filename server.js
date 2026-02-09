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
    console.log(`🚀 Starting ${BOT_NAME} (Hunter Mode)...`);

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
    // 1. DISCORD SETUP (Hunter Logic)
    // ==========================================
    console.log("🔑 Logging in...");
    await page.goto(VC_URL, { waitUntil: 'domcontentloaded' });

    try {
        console.log("⏳ Hunting for 'Join Voice' button...");
        await delay(5000); // Wait for Discord to fully load UI

        // 🟢 THE HUNTER LOGIC
        // Scans every single button on the page for the text "Join Voice"
        const clicked = await page.evaluate(() => {
            // Get every button-like element
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'));
            
            // Find the one that has "Join Voice" inside it
            const target = allButtons.find(btn => btn.innerText && btn.innerText.includes("Join Voice"));
            
            if (target) {
                target.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            console.log("✅ Hunter found and clicked 'Join Voice'!");
        } else {
            console.log("⚠️ Hunter could not find the button. Trying Double-Click fallback...");
            // Fallback: Double click "General" (or whatever name is usually top)
            // You can customize this fallback if needed
        }

        await delay(3000); 
        
        // 🔴 AUTO-DEAFEN
        console.log("Rx Deafen Mode...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button[aria-label="Deafen"]'));
            if (btns.length > 0) btns[0].click();
        });

        // Step B: Open Chat
        console.log("💬 Opening Chat...");
        const chatBtnSelector = 'button[aria-label="Show Chat"]';
        const chatAlreadyOpen = await page.$('div[class*="chat-"]'); 
        if (!chatAlreadyOpen) {
            try {
                await page.waitForSelector(chatBtnSelector, { timeout: 5000 });
                await page.click(chatBtnSelector);
            } catch(e) {}
        }

        // Step C: Share Screen
        console.log("🎥 Clicking 'Share Screen'...");
        try {
            await page.waitForSelector('button[aria-label*="Share"]', { timeout: 5000 });
            await page.click('button[aria-label*="Share"]');
            console.log("👉 ACTION: Select 'Entire Screen' -> 'Go Live'");
        } catch(e) {}

    } catch (e) {
        console.log(`⚠️ Join Failed: ${e.message}`);
    }

    // ==========================================
    // 2. HELPER: RUN CLI
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
    // 3. MAIN LOGIC (With Controls)
    // ==========================================
    let videoTab = null;

    async function playAnime(query, epNumber) {
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

    async function disconnectBot() {
        console.log("🛑 Stop command received.");
        await browser.close();
        process.exit(0);
    }

    // ==========================================
    // 4. MONITORING LOOP
    // ==========================================
    let lastMsg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[class*="messageContent"]');
        return msgs.length ? msgs[msgs.length - 1].innerText : "";
    });

    console.log(`🛡️ Ignoring Old Messages. Waiting for NEW commands...`);

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
                    else if (lowerCmd.includes("stop") || lowerCmd.includes("disconnect")) await disconnectBot();
                }
            }
        } catch (e) {}
        await delay(2000); 
    }
})();