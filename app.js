document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const loadingArea = document.getElementById('loading-area');
    const resultsArea = document.getElementById('results-area');

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;

        // Show loading state
        loadingArea.classList.remove('hidden');
        resultsArea.innerHTML = ''; // Clear previous results
        let allResults = [];
        let allRawTexts = [];

        try {
            // Process each file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`Processing ${file.name}...`);

                // Read image and run OCR using Tesseract.js
                // 'eng' works best for reading alphanumeric SKUs
                const { data: { text } } = await Tesseract.recognize(file, 'eng', {
                    logger: m => console.log(m) // Log progress
                });

                console.log("Extracted text:", text);
                allRawTexts.push(text);

                const skus = extractSKUs(text);
                allResults = allResults.concat(skus);
            }

            // Remove duplicates across multiple images
            const uniqueResults = [];
            const seenUrls = new Set();
            for (const r of allResults) {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    uniqueResults.push(r);
                }
            }

            renderResults(uniqueResults, allRawTexts.join(' '));

        } catch (error) {
            console.error("OCR Error:", error);
            renderError(`画像の読み取り中にエラーが発生しました。<br><small style='opacity:0.8;'>詳細: ${error.message || error}</small>`);
        } finally {
            // Hide loading state
            loadingArea.classList.add('hidden');
            // Clear input so the same file can be selected again
            fileInput.value = '';
        }
    });

    function extractSKUs(rawText) {
        // 1. Convert full-width characters to half-width
        let text = rawText.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        // 2. Remove all spaces and newlines
        text = text.replace(/\s+/g, '');

        const results = [];

        // 3. Match YA-[a-z][0-9]{9,10} (ヤフオク)
        // OCR might confuse hyphens, so we allow various hyphen-like characters
        // The ID should be exactly one letter followed by 9 to 10 digits. Anything after that is ignored.
        const regexYA = /(?:YA|ya|ＹＡ|ｙａ)[-ー━‐_~=・.]*([a-zA-Z][0-9]{10})/gi;
        let matchYA;
        while ((matchYA = regexYA.exec(text)) !== null) {
            // Force lowercase for 's' and the ID part as per convention, though original might be kept.
            // "番号部分は勝手に変えないこと" -> We just lowercase 's' and 'z' but keep the rest as parsed, though usually it's numbers. 
            // Wait, Japanese OCR might output 'S' instead of 's', so lowercase makes it safer.
            let idPart = matchYA[1].toLowerCase();
            results.push({
                serviceName: 'ヤフオク',
                sku: 'YA-' + idPart,
                id: idPart,
                url: `https://page.auctions.yahoo.co.jp/jp/auction/${idPart}`,
                badgeClass: 'yahoo'
            });
        }

        // 4. Match YFM-[a-z][0-9]{9,10} (Yahooフリマ)
        const regexYFM = /(?:YFM|yfm|ＹＦＭ|ｙｆｍ)[-ー━‐_~=・.]*([a-zA-Z][0-9]{9})/gi;
        let matchYFM;
        while ((matchYFM = regexYFM.exec(text)) !== null) {
            let idPart = matchYFM[1].toLowerCase();
            results.push({
                serviceName: 'Yahooフリマ',
                sku: 'YFM-' + idPart,
                id: idPart,
                url: `https://paypayfleamarket.yahoo.co.jp/item/${idPart}`,
                badgeClass: 'fleamarket'
            });
        }

        return results;
    }

    function renderResults(results, rawText = "") {
        if (results.length === 0) {
            let debugText = rawText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            // limit length
            if (debugText.length > 100) debugText = debugText.substring(0, 100) + "...";

            renderError(`有効なSKUを認識できませんでした。<br><small style='color:#EF4444; margin-top:4px; display:block;'>対応形式: YA-英字1文字+数字9〜10桁 または YFM-英字1文字+数字9〜10桁</small><div style='margin-top:12px; font-size:11px; color:#666; background:#f1f5f9; padding:8px; border-radius:4px; word-break:break-all;'>【読み取り確認用】<br>${debugText}</div>`);
            return;
        }

        const isAndroid = /Android/i.test(navigator.userAgent);

        results.forEach((res, index) => {
            const card = document.createElement('div');
            card.className = 'result-card';
            card.style.animationDelay = `${index * 0.1}s`;

            let appUrl = res.url; // Default to https url which triggers App Links/Universal Links

            // For Android, standard intent links sometimes fail if the app package changed or intent filters are strict.
            // Using standard https URLs is the recommended way for Android App Links and iOS Universal Links.
            // However, to strongly suggest the app, we can use the intent scheme with ACTION_VIEW.
            // For Android, App Links usually work best with standard https URLs without target="_blank".
            // If we use intent:// and the browser doesn't support it, it breaks.
            // Let's use the standard native link for Android, and custom scheme for iOS.
            if (!isAndroid) {
                // For iOS and others
                if (res.serviceName === 'ヤフオク') {
                    appUrl = `yjauctions://auction/${res.id}`;
                } else if (res.serviceName === 'Yahooフリマ') {
                    appUrl = `paypayfleamarket://item/${res.id}`;
                }
            }

            // Note: For 'アプリで開く', we drop target="_blank" so mobile OS intercepts the navigation natively 
            // without forcing a new browser tab.
            const iosFallbackScript = !isAndroid ? `onclick="setTimeout(function(){ window.location.href='${res.url}'; }, 500);"` : "";

            card.innerHTML = `
                <div class="result-header">
                    <span class="service-badge ${res.badgeClass}">${res.serviceName}</span>
                    <span class="sku-text">${res.sku}</span>
                </div>
                <div class="action-buttons">
                    <a href="${appUrl}" ${iosFallbackScript} class="action-btn app-btn">
                        📦 アプリで開く
                    </a>
                    <a href="${res.url}" target="_blank" rel="noopener noreferrer" class="action-btn browser-btn">
                        🌐 ブラウザで開く
                    </a>
                </div>
            `;


            resultsArea.appendChild(card);
        });
    }

    function renderError(message) {
        const errorCard = document.createElement('div');
        errorCard.className = 'error-card';
        errorCard.innerHTML = `
                <h3>エラー</h3>
                    <p>${message}</p>
            `;
        resultsArea.appendChild(errorCard);
    }
});
