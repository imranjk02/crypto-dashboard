document.addEventListener("DOMContentLoaded", () => {
    loadMarket();
    loadWatchlist();
    loadPortfolio();
    loadProfile();
    loadSettings();
    setupForms();
    setupSearch();
    setupTheme();
    setupCoinDetails();
});

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function money(value) {
    const n = Number(value) || 0;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2
    }).format(n);
}

function number(value) {
    const n = Number(value) || 0;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n);
}

function change(value) {
    const n = Number(value) || 0;
    return `<span class="${n >= 0 ? "positive" : "negative"}">${n >= 0 ? "+" : ""}${n.toFixed(2)}%</span>`;
}
async function loadMarket() {
    const table = document.getElementById("cryptoTable") || document.getElementById("marketTable");
    if (!table) return;

    try {
        const coins = await api("/api/market");
        console.log("MARKET DATA:", coins);

        if (!Array.isArray(coins) || coins.length === 0) {
            table.innerHTML = `<tr><td colspan="7" class="empty">Market data is temporarily unavailable. Please refresh the page.</td></tr>`;
            return;
        }

        const isCryptoPage = document.getElementById("cryptoTable") !== null;

        table.innerHTML = coins.map((coin, index) => {
            const price = coin.current_price ?? 0;
            const marketCap = coin.market_cap ?? 0;
            const volume = coin.total_volume ?? 0;
            const coinName = coin.name || coin.id;
            const symbol = (coin.symbol || "").toUpperCase();

            return `<tr>
                ${isCryptoPage ? `<td>${index + 1}</td>` : ""}
                <td>
                    <a href="/coin/${coin.id}" class="coin-cell">
                        ${coin.image ? `<img src="${coin.image}" class="coin-icon" alt="${coinName}">` : ""}
                        <span><strong>${coinName}</strong><small>${symbol}</small></span>
                    </a>
                </td>
                <td>${money(price)}</td>
                <td>${change(coin.price_change_percentage_24h)}</td>
                <td>${money(marketCap)}</td>
                ${isCryptoPage ? `<td>${money(volume)}</td><td><a href="/coin/${coin.id}" class="btn btn-ghost btn-sm">View</a></td>` : ""}
            </tr>`;
        }).join("");
    } catch (error) {
        console.error("MARKET ERROR:", error);
        table.innerHTML = `<tr><td colspan="7" class="empty">Unable to load market data. Please refresh the page.</td></tr>`;
    }
}

async function loadWatchlist() {
    const container = document.getElementById("watchlistGrid") || document.getElementById("dashboardWatchlist");
    if (!container) return;

    try {
        const items = await api("/api/watchlist");

        if (!Array.isArray(items) || !items.length) {
            container.innerHTML = `<div class="empty">Your watchlist is empty. Add some coins to start tracking.</div>`;
            updateText("watchlistCount", "0 Coins");
            return;
        }

        let coins = [];

        try {
            coins = await api("/api/market");
        } catch (error) {
            console.error("WATCHLIST MARKET ERROR:", error);
            container.innerHTML = `<div class="empty">Unable to load market prices.</div>`;
            return;
        }

        const map = Object.fromEntries(coins.map(coin => [coin.id, coin]));

        const cards = items.map(item => {
            const coin = map[item.coin_id];
            if (!coin) return "";

            return `<div class="watch-card">
                <div class="coin-cell">
                    <img class="coin-icon" src="${coin.image}" alt="${coin.name}">
                    <span><strong>${coin.name}</strong><small>${coin.symbol.toUpperCase()}</small></span>
                </div>
                <strong>${money(coin.current_price)}</strong>
                ${change(coin.price_change_percentage_24h)}
                <button type="button" class="btn btn-ghost btn-sm" onclick="removeWatchlist('${coin.id}')">Remove</button>
            </div>`;
        }).join("");

        if (!cards.trim()) {
            container.innerHTML = `<div class="empty">Unable to find the selected coins.</div>`;
        } else {
            container.innerHTML = cards;
        }

        updateText("watchlistCount", `${items.length} Coins`);
    } catch (error) {
        console.error("WATCHLIST ERROR:", error);
        container.innerHTML = `<div class="empty">Unable to load watchlist.</div>`;
    }
}

async function addWatchlist(coinId) {
    try {
        await api("/api/watchlist", {
            method: "POST",
            body: JSON.stringify({ coin_id: coinId })
        });

        showToast("Added to watchlist.");
        await loadWatchlist();

        const button = document.getElementById("watchlistBtn");
        if (button) button.textContent = "✓ Added to Watchlist";
    } catch (error) {
        console.error("ADD WATCHLIST ERROR:", error);
        showToast(error.message);
    }
}

async function removeWatchlist(coinId) {
    try {
        await api("/api/watchlist", {
            method: "DELETE",
            body: JSON.stringify({ coin_id: coinId })
        });

        showToast("Removed from watchlist.");
        await loadWatchlist();

        if (document.getElementById("watchlistBtn")) setupCoinDetails();
    } catch (error) {
        console.error("REMOVE WATCHLIST ERROR:", error);
        showToast(error.message);
    }
}
async function loadPortfolio() {
    const table = document.getElementById("portfolioTable");
    if (!table) return;

    try {
        const items = await api("/api/portfolio");

        if (!Array.isArray(items) || !items.length) {
            table.innerHTML = `<tr><td colspan="7" class="empty">No portfolio assets yet.</td></tr>`;
            updatePortfolioStats(0, 0, 0, 0, 0);
            return;
        }

        let coins = [];
        try {
            coins = await api("/api/market");
        } catch (error) {
            console.error("PORTFOLIO MARKET ERROR:", error);
            coins = [];
        }

        const map = Object.fromEntries(coins.map(coin => [coin.id, coin]));
        let totalValue = 0, totalInvested = 0, validAssets = 0;

        const rows = items.map(item => {
            const coin = map[item.coin_id];
            const quantity = Number(item.quantity) || 0;
            const buyPrice = Number(item.buy_price) || 0;
            let currentPrice = buyPrice;

            if (coin) currentPrice = Number(coin.current_price) || buyPrice;

            const value = quantity * currentPrice;
            const invested = quantity * buyPrice;
            const profit = value - invested;

            totalValue += value;
            totalInvested += invested;
            validAssets++;

            const coinName = coin ? coin.name : item.coin_id;
            const symbol = coin ? coin.symbol.toUpperCase() : item.coin_id.toUpperCase();
            const image = coin ? coin.image : "";
            const profitClass = profit >= 0 ? "positive" : "negative";

            return `<tr>
                <td>
                    <a href="/coin/${item.coin_id}" class="coin-cell">
                        ${image ? `<img class="coin-icon" src="${image}" alt="${coinName}">` : ""}
                        <span><strong>${coinName}</strong><small>${symbol}</small></span>
                    </a>
                </td>
                <td>${number(quantity)}</td>
                <td>${money(buyPrice)}</td>
                <td>${money(currentPrice)}</td>
                <td>${money(value)}</td>
                <td class="${profitClass}">${money(profit)}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" onclick="deletePortfolio(${item.id})">Delete</button></td>
            </tr>`;
        }).join("");

        table.innerHTML = rows;

        const totalProfit = totalValue - totalInvested;
        const profitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

        updatePortfolioStats(totalValue, totalInvested, totalProfit, profitPercent, validAssets);
    } catch (error) {
        console.error("PORTFOLIO ERROR:", error);
        table.innerHTML = `<tr><td colspan="7" class="empty">Unable to load portfolio.</td></tr>`;
    }
}

function updatePortfolioStats(totalValue, totalInvested, totalProfit, profitPercent, assetCount) {
    updateText("totalPortfolioValue", money(totalValue));
    updateText("totalInvested", money(totalInvested));
    updateText("totalProfitLoss", money(totalProfit));
    updateText("totalProfitPercent", `${profitPercent.toFixed(2)}%`);
    updateText("portfolioAssetCount", String(assetCount));
    updateText("portfolioValue", money(totalValue));
    updateText("portfolioProfit", money(totalProfit));
    updateText("portfolioProfitPercent", `${profitPercent.toFixed(2)}%`);

    const profitElement = document.getElementById("totalProfitLoss");
    if (profitElement) {
        profitElement.classList.toggle("positive", totalProfit >= 0);
        profitElement.classList.toggle("negative", totalProfit < 0);
    }
}

async function deletePortfolio(id) {
    if (!confirm("Remove this asset from your portfolio?")) return;

    try {
        await api("/api/portfolio", {
            method: "DELETE",
            body: JSON.stringify({ id: id })
        });

        showToast("Asset removed from portfolio.");
        await loadPortfolio();
    } catch (error) {
        console.error("DELETE PORTFOLIO ERROR:", error);
        showToast(error.message);
    }
}
function openPortfolioModal() {
    const modal = document.getElementById("portfolioModal");
    if (!modal) return;

    modal.classList.add("show");
    document.body.style.overflow = "hidden";

    const input = modal.querySelector('input[name="coin_id"]');
    if (input) setTimeout(() => input.focus(), 100);
}

function closePortfolioModal() {
    const modal = document.getElementById("portfolioModal");
    if (!modal) return;

    modal.classList.remove("show");
    document.body.style.overflow = "";
}

document.addEventListener("click", event => {
    const modal = document.getElementById("portfolioModal");
    if (!modal) return;

    if (modal.classList.contains("show") && event.target === modal) closePortfolioModal();
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    const modal = document.getElementById("portfolioModal");
    if (modal && modal.classList.contains("show")) closePortfolioModal();
});

function setupForms() {
    const portfolioForm = document.getElementById("portfolioForm");

    if (portfolioForm) {
        portfolioForm.addEventListener("submit", async event => {
            event.preventDefault();

            const form = new FormData(portfolioForm);
            const coinId = String(form.get("coin_id") || "").trim().toLowerCase();
            const quantity = Number(form.get("quantity"));
            const buyPrice = Number(form.get("buy_price"));

            if (!coinId) {
                showToast("Please enter a coin.");
                return;
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                showToast("Enter a valid quantity.");
                return;
            }

            if (!Number.isFinite(buyPrice) || buyPrice < 0) {
                showToast("Enter a valid buy price.");
                return;
            }

            const submitButton = portfolioForm.querySelector('button[type="submit"]');

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Adding...";
            }

            try {
                await api("/api/portfolio", {
                    method: "POST",
                    body: JSON.stringify({ coin_id: coinId, quantity: quantity, buy_price: buyPrice })
                });

                portfolioForm.reset();
                closePortfolioModal();
                showToast("Asset added to portfolio.");
                await loadPortfolio();
            } catch (error) {
                console.error("ADD PORTFOLIO ERROR:", error);
                showToast(error.message);
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = "Add to Portfolio →";
                }
            }
        });
    }

    const profileForm = document.getElementById("profileForm");

    if (profileForm) {
        profileForm.addEventListener("submit", async event => {
            event.preventDefault();

            const form = new FormData(profileForm);

            try {
                const user = await api("/api/profile", {
                    method: "PUT",
                    body: JSON.stringify({ name: form.get("name"), email: form.get("email") })
                });

                updateText("profileName", user.name);
                updateText("profileEmail", user.email);
                showToast("Profile updated.");
            } catch (error) {
                console.error("PROFILE ERROR:", error);
                showToast(error.message);
            }
        });
    }

    const passwordForm = document.getElementById("passwordForm");

    if (passwordForm) {
        passwordForm.addEventListener("submit", async event => {
            event.preventDefault();

            const form = new FormData(passwordForm);

            try {
                await api("/api/password", {
                    method: "POST",
                    body: JSON.stringify({
                        current_password: form.get("current_password"),
                        new_password: form.get("new_password"),
                        confirm_password: form.get("confirm_password")
                    })
                });

                passwordForm.reset();
                showToast("Password updated.");
            } catch (error) {
                console.error("PASSWORD ERROR:", error);
                showToast(error.message);
            }
        });
    }
}
function setupSearch() {
    const search = document.getElementById("cryptoSearch");
    if (!search) return;

    search.addEventListener("input", () => {
        const query = search.value.toLowerCase().trim();
        const rows = document.querySelectorAll("#cryptoTable tr");

        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(query) ? "" : "none";
        });
    });
}

async function setupCoinDetails() {
    const name = document.getElementById("coinName");
    if (!name) return;

    const coinId = location.pathname.split("/").filter(Boolean).pop();
    if (!coinId) return;

    try {
        const coin = await api(`/api/coin/${coinId}`);

        updateText("coinName", coin.name || "Unknown Coin");
        updateText("coinSymbol", coin.symbol ? coin.symbol.toUpperCase() : "");

        const marketData = coin.market_data || {};

        updateText("coinPrice", money(marketData.current_price?.usd));
        updateText("coinMarketCap", money(marketData.market_cap?.usd));
        updateText("coinVolume", money(marketData.total_volume?.usd));
        updateText("coinRank", `#${coin.market_cap_rank || "--"}`);
        updateText("coinHigh", money(marketData.high_24h?.usd));
        updateText("coinLow", money(marketData.low_24h?.usd));
        updateText("coinSupply", number(marketData.circulating_supply));
        updateText("coinTotalSupply", number(marketData.total_supply));
        updateText("coinAth", money(marketData.ath?.usd));

        const change24h = marketData.price_change_percentage_24h;
        updateText("coinChange", `${Number(change24h || 0).toFixed(2)}%`);

        const description = document.getElementById("coinDescription");

        if (description) {
            const text = coin.description?.en || "No description available.";
            description.innerHTML = text.replace(/<[^>]*>/g, "");
        }

        const website = document.getElementById("coinWebsite");

        if (website && coin.links?.homepage?.[0]) {
            website.href = coin.links.homepage[0];
            website.style.display = "inline-flex";
        }

        const watchButton = document.getElementById("watchlistBtn");

        if (watchButton) watchButton.onclick = () => addWatchlist(coinId);

        await loadChart(coinId);
    } catch (error) {
        console.error("COIN DETAILS ERROR:", error);
        updateText("coinName", "Coin not found");
        updateText("coinSymbol", "");
    }
}
async function loadChart(coinId) {
    const canvas = document.getElementById("coinChart");
    if (!canvas) return;

    const daysElement = document.getElementById("chartDays");
    let currentDays = daysElement?.value || "30";

    async function draw(days) {
        try {
            const data = await api(`/api/coin/${coinId}/chart?days=${days}`);
            const points = data.prices || [];

            if (!points.length) {
                console.log("No chart data.");
                return;
            }

            const prices = points.map(point => Number(point[1]));
            const container = canvas.parentElement;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const cssWidth = Math.max(rect.width - 10, 300);
            const cssHeight = Math.max(rect.height - 10, 250);
            const dpr = window.devicePixelRatio || 1;

            canvas.width = cssWidth * dpr;
            canvas.height = cssHeight * dpr;
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssWidth, cssHeight);

            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const range = max - min || 1;

            const paddingLeft = 55;
            const paddingRight = 25;
            const paddingTop = 30;
            const paddingBottom = 40;

            const chartWidth = cssWidth - paddingLeft - paddingRight;
            const chartHeight = cssHeight - paddingTop - paddingBottom;

            const chartPoints = prices.map((price, index) => {
                const x = paddingLeft + (index / Math.max(prices.length - 1, 1)) * chartWidth;
                const y = paddingTop + (1 - (price - min) / range) * chartHeight;
                return { x, y };
            });

            const background = ctx.createLinearGradient(0, 0, 0, cssHeight);
            background.addColorStop(0, "#11182b");
            background.addColorStop(1, "#080c17");
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, cssWidth, cssHeight);

            ctx.strokeStyle = "rgba(139,108,255,0.12)";
            ctx.lineWidth = 1;

            for (let i = 0; i <= 5; i++) {
                const y = paddingTop + (chartHeight / 5) * i;
                ctx.beginPath();
                ctx.moveTo(paddingLeft, y);
                ctx.lineTo(cssWidth - paddingRight, y);
                ctx.stroke();
            }

            ctx.font = "12px Arial";
            ctx.fillStyle = "#8b96b5";
            ctx.textAlign = "right";

            for (let i = 0; i <= 5; i++) {
                const price = max - ((max - min) / 5) * i;
                const y = paddingTop + (chartHeight / 5) * i;
                ctx.fillText(money(price), paddingLeft - 10, y + 4);
            }

            const areaGradient = ctx.createLinearGradient(0, paddingTop, 0, cssHeight);
            areaGradient.addColorStop(0, "rgba(139,108,255,0.30)");
            areaGradient.addColorStop(0.6, "rgba(139,108,255,0.08)");
            areaGradient.addColorStop(1, "rgba(139,108,255,0)");

            ctx.beginPath();

            chartPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });

            const lastPoint = chartPoints[chartPoints.length - 1];
            const firstPoint = chartPoints[0];

            ctx.lineTo(lastPoint.x, cssHeight - paddingBottom);
            ctx.lineTo(firstPoint.x, cssHeight - paddingBottom);
            ctx.closePath();
            ctx.fillStyle = areaGradient;
            ctx.fill();

            ctx.beginPath();

            chartPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });

            ctx.strokeStyle = "rgba(139,108,255,0.28)";
            ctx.lineWidth = 10;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.shadowBlur = 18;
            ctx.shadowColor = "#8b6cff";
            ctx.stroke();

            ctx.beginPath();

            chartPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });

            const lineGradient = ctx.createLinearGradient(paddingLeft, 0, cssWidth - paddingRight, 0);
            lineGradient.addColorStop(0, "#8b6cff");
            lineGradient.addColorStop(0.45, "#a98cff");
            lineGradient.addColorStop(1, "#55e6b3");

            ctx.shadowBlur = 0;
            ctx.strokeStyle = lineGradient;
            ctx.lineWidth = 3;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();

            const start = chartPoints[0];

            ctx.beginPath();
            ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#8b6cff";
            ctx.fill();

            const end = chartPoints[chartPoints.length - 1];

            ctx.beginPath();
            ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = "#55e6b3";
            ctx.shadowBlur = 15;
            ctx.shadowColor = "#55e6b3";
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.font = "bold 12px Arial";
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.fillText(money(prices[prices.length - 1]), end.x + 10, end.y - 10);
        } catch (error) {
            console.error("CHART ERROR:", error);
        }
    }

    await draw(currentDays);

    if (daysElement) {
        daysElement.addEventListener("change", () => {
            currentDays = daysElement.value;
            draw(currentDays);
        });
    }

    window.addEventListener("resize", () => draw(currentDays));
}
async function loadProfile() {
    if (!document.getElementById("profileName")) return;

    try {
        const user = await api("/api/profile");
        updateText("profileName", user.name);
        updateText("profileEmail", user.email);

        const avatar = document.getElementById("profileAvatar");
        if (avatar && user.name) avatar.textContent = user.name.charAt(0).toUpperCase();

        const nameInput = document.getElementById("profileNameInput");
        const emailInput = document.getElementById("profileEmailInput");

        if (nameInput) nameInput.value = user.name || "";
        if (emailInput) emailInput.value = user.email || "";
    } catch (error) {
        console.error("PROFILE LOAD ERROR:", error);
    }
}

async function loadSettings() {
    const darkMode = document.getElementById("darkMode");
    if (!darkMode) return;

    try {
        const settings = await api("/api/settings");
        const currency = document.getElementById("currency");

        darkMode.checked = settings.theme === "dark";
        if (currency) currency.value = settings.currency || "usd";

        document.body.classList.toggle("light", settings.theme === "light");
    } catch (error) {
        console.error("SETTINGS LOAD ERROR:", error);
    }
}

function setupTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";

    if (savedTheme === "light") document.body.classList.add("light-theme");
    else document.body.classList.remove("light-theme");

    const toggle = document.getElementById("darkMode");
    if (!toggle) return;

    toggle.checked = savedTheme === "dark";

    toggle.addEventListener("change", function () {
        const theme = this.checked ? "dark" : "light";
        localStorage.setItem("theme", theme);

        if (theme === "light") document.body.classList.add("light-theme");
        else document.body.classList.remove("light-theme");

        showToast(theme === "light" ? "Light mode enabled." : "Dark mode enabled.");
    });
}

function updateText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? "";
}

function showToast(message) {
    let toast = document.getElementById("toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(window.cryptoDashToastTimer);

    window.cryptoDashToastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

window.openPortfolioModal = openPortfolioModal;
window.closePortfolioModal = closePortfolioModal;
window.addWatchlist = addWatchlist;
window.removeWatchlist = removeWatchlist;
window.deletePortfolio = deletePortfolio;

