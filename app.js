document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const loadingArea = document.getElementById('loading-area');
    const resultsArea = document.getElementById('results-area');
    const reviewArea = document.getElementById('review-area');
    const ocrTextInput = document.getElementById('ocr-text-input');
    const reprocessBtn = document.getElementById('reprocess-btn');

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

                // Pre-process image to improve OCR accuracy
                const processedImageData = await preprocessImage(file);

                // Run OCR using the processed image
                const { data: { text } } = await Tesseract.recognize(processedImageData, 'eng+jpn', {
                    logger: m => console.log(m)
                });

                console.log("Extracted text:", text);
                allRawTexts.push(text);
            }

            const combinedText = allRawTexts.join('\n');

            // Show review area and set text (Show full text as requested for manual correction)
            reviewArea.classList.remove('hidden');
            ocrTextInput.value = combinedText;

            // Automatically run extraction once
            processAndRender(combinedText);

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

    // Handle manual re-processing
    reprocessBtn.addEventListener('click', () => {
        const text = ocrTextInput.value;
        processAndRender(text);

        // Scroll to results
        resultsArea.scrollIntoView({ behavior: 'smooth' });
    });

    function processAndRender(text) {
        resultsArea.innerHTML = ''; // Clear previous results
        const skus = extractSKUs(text);

        // Remove duplicates
        const uniqueResults = [];
        const seenUrls = new Set();
        for (const r of skus) {
            if (!seenUrls.has(r.url)) {
                seenUrls.add(r.url);
                uniqueResults.push(r);
            }
        }

        renderResults(uniqueResults, text);
    }

    async function preprocessImage(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.getElementById('canvas');
                    const ctx = canvas.getContext('2d');

                    // Set canvas size (2x scale for much better clarity)
                    const scale = 2;
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;

                    // STRONG FILTERS:
                    // 1. invert(1) - Makes background white and text dark.
                    // 2. grayscale(1) - Removes noise.
                    // 3. contrast(5) - MAXIMUM sharp letters.
                    ctx.filter = 'invert(1) grayscale(1) contrast(5) brightness(1.2)';
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    // Output as a data URL
                    resolve(canvas.toDataURL('image/png'));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function extractSKUs(rawText) {
        // 1. Convert full-width characters to half-width
        let text = rawText.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        // 2. Remove all spaces and newlines
        text = text.replace(/\s+/g, '');

        const results = [];

        // 3. Match YA-[a-z][0-9]{10} (ヤフオク)
        // More lenient prefix to handle OCR misreads (e.g., Y/4, vA, Ya, Y4)
        const regexYA = /(?:YA|ya|Y[Ａ-Ｚａ-ｚ０-９\/\-‐]|vA|v4|V4|YI|yi)[-ー━‐_~=・.]*([a-zA-Z][0-9]{10})/gi;
        let matchYA;
        while ((matchYA = regexYA.exec(text)) !== null) {
            let idPart = matchYA[1].toLowerCase();
            results.push({
                serviceName: 'ヤフオク',
                sku: 'YA-' + idPart,
                id: idPart,
                url: `https://page.auctions.yahoo.co.jp/jp/auction/${idPart}`,
                badgeClass: 'yahoo'
            });
        }

        // 4. Match YFM-[a-z][0-9]{9} (Yahooフリマ)
        // Lenient prefix for YFM (e.g. YIFM, VFM)
        const regexYFM = /(?:YFM|yfm|Y[IＩ]FM|vfm|VFM)[-ー━‐_~=・.]*([a-zA-Z][0-9]{9})/gi;
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

        // 5. Harder fallback: Support IDs without prefix (if they are alone or separated)
        // This is mainly for the manual correction box where user might just type the ID.
        if (results.length === 0) {
            const rawLines = rawText.split(/[\s\n,]+/).map(s => s.trim());
            for (let line of rawLines) {
                // Convert full-width again for safety
                line = line.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

                // 11 chars (letter + 10 digits) -> Auctions
                if (/^[a-zA-Z][0-9]{10}$/.test(line)) {
                    results.push({
                        serviceName: 'ヤフオク',
                        sku: 'YA-' + line.toLowerCase(),
                        id: line.toLowerCase(),
                        url: `https://page.auctions.yahoo.co.jp/jp/auction/${line.toLowerCase()}`,
                        badgeClass: 'yahoo'
                    });
                }
                // 10 chars (letter + 9 digits) -> Flea Market
                else if (/^[a-zA-Z][0-9]{9}$/.test(line)) {
                    results.push({
                        serviceName: 'Yahooフリマ',
                        sku: 'YFM-' + line.toLowerCase(),
                        id: line.toLowerCase(),
                        url: `https://paypayfleamarket.yahoo.co.jp/item/${line.toLowerCase()}`,
                        badgeClass: 'fleamarket'
                    });
                }
            }
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
