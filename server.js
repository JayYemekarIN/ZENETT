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
    console.log(`🚀 Starting ${BOT_NAME} (Fixed Auto-Join)...`);

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
    // 1. DISCORD SETUP (Using Your Selector)
    // ==========================================
    console.log("🔑 Logging in...");
    await page.goto(VC_URL, { waitUntil: 'domcontentloaded' });

    try {
        console.log("⏳ Waiting for Join button...");
        
        // 🟢 FIX: Using the selector you provided (with wildcard for stability)
        // Targets: div.joinButton__5aa3a > button
        const joinSelector = 'div[class*="joinButton"] > button';
        
        await page.waitForSelector(joinSelector, { timeout: 10000 });
        await page.click(joinSelector);
        console.log("✅ Clicked 'Join Voice' successfully!");

        await delay(2000); 

        // Step B: Open Chat
        console.log("💬 Opening Chat...");
        const chatBtn = 'button[aria-label="Show Chat"]';
        const chatAlreadyOpen = await page.$('div[class*="chat-"]'); 
        if (!chatAlreadyOpen) {
            try {
                await page.waitForSelector(chatBtn, { timeout: 5000 });
                await page.click(chatBtn);
            } catch(e) {}
        }

        // Step C: Share Screen
        console.log("🎥 Clicking 'Share Screen'...");
        const shareBtn = 'button[aria-label="Share Your Screen"]';
        try {
            await page.waitForSelector(shareBtn, { timeout: 5000 });
            await page.click(shareBtn);
            console.log("👉 ACTION: Select 'Entire Screen' -> 'Go Live'");
        } catch(e) {}

    } catch (e) {
        console.log(`⚠️ Auto-Join Issue: ${e.message}`);
        console.log("👉 You may need to click Join manually.");
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
    // 3. MAIN LOGIC (With Verbose Debugging)
    // ==========================================
    let videoTab = null;

    async function playAnime(query, epNumber) {
        console.log(`🔍 [DEBUG] Step 1: Searching UUID for "${query}"...`);
        
        if (videoTab) { try { await videoTab.close(); } catch (e) {} }
        videoTab = await browser.newPage();
        videoTab.setDefaultNavigationTimeout(60000);

        try {
            console.log("   -> Going to AnimePahe...");
            await videoTab.goto(ANIME_PAHE_BASE, { waitUntil: 'domcontentloaded' });
            
            console.log("   -> Typing search query...");
            const searchInput = 'input[name="q"]';
            await videoTab.waitForSelector(searchInput, { visible: true });
            await videoTab.type(searchInput, query, { delay: 100 });
            
            console.log("   -> Clicking first result...");
            const firstResult = '.search-results a';
            await videoTab.waitForSelector(firstResult, { visible: true, timeout: 10000 });
            await videoTab.click(firstResult);
            
            console.log("   -> Waiting for Anime Page load...");
            await videoTab.waitForFunction(() => document.URL.includes('/anime/'), { timeout: 30000 });
            const uuidUrl = videoTab.url();
            console.log(`✅ [DEBUG] Found UUID: ${uuidUrl}`);

            console.log("⚙️ [DEBUG] Step 2: Running CLI Tool...");
            const streamLink = await getDirectLinkFromCLI(uuidUrl, epNumber);
            
            if (!streamLink) throw new Error("CLI finished but returned NO link.");
            console.log(`💎 [DEBUG] Link Found!`);

            console.log("📺 [DEBUG] Step 3: Injecting Player...");
            const playerHtml = `
                <html>
                    <body style="background-color: black; margin: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh;">
                        <video controls autoplay style="width: 100%; height: 100vh;">
                            <source src="${streamLink}" type="video/mp4">
                        </video>
                    </body>
                </html>
            `;
            await videoTab.setContent(playerHtml);
            
            console.log("   -> Fullscreening...");
            await delay(2000);
            await videoTab.evaluate(() => {
                const v = document.querySelector('video');
                if (v) v.requestFullscreen().catch(err => console.error("FS Error:", err));
            });

            console.log("✅ [SUCCESS] Now Playing!");

        } catch (e) {
            console.error(`❌ [FAILURE] Stopped at: ${e.message}`);
            console.error(e.stack); 
        }
    }

    // ==========================================
    // 4. MONITORING LOOP
    // ==========================================
    console.log(`👀 Watching for @${BOT_NAME}...`);
    let lastMsg = "";

    while (true) {
        try {
            const current = await page.evaluate((bot) => {
                const msgs = document.querySelectorAll('[class*="messageContent"]');
                return msgs.length ? msgs[msgs.length - 1].innerText : null;
            }, BOT_NAME);

            if (current && current !== lastMsg && current.toLowerCase().includes(`@${BOT_NAME.toLowerCase()}`)) {
                lastMsg = current;
                console.log(`📩 Command: "${current}"`);
                
                const match = current.match(/play\s+(.+)\s+(\d+)/i);
                if (match) {
                    await playAnime(match[1].trim(), match[2].trim());
                }
            }
        } catch (e) {}
        await delay(3000);
    }
})();