const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.body.innerHTML = `
    <div style="max-width:720px;margin:40px auto;padding:24px;font-family:sans-serif;line-height:1.7;">
      <h1>config.js が見つからないか、設定値が空です</h1>
      <p>config.example.js を config.js にコピーし、Supabase の URL と publishable / anon key を設定してください。</p>
    </div>
  `;
  throw new Error("Supabase config is missing");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);
const BUCKET = "card-images";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const messageEl = document.getElementById("message");
const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("emailInput");
const signOutBtn = document.getElementById("signOutBtn");
const userArea = document.getElementById("userArea");
const userEmail = document.getElementById("userEmail");
const cardForm = document.getElementById("cardForm");
const imageInput = document.getElementById("imageInput");
const cardNameInput = document.getElementById("cardNameInput");
const appraisalInput = document.getElementById("appraisalInput");
const addStoreBtn = document.getElementById("addStoreBtn");
const storesContainer = document.getElementById("storesContainer");
const maxPricePreview = document.getElementById("maxPricePreview");
const diffPreview = document.getElementById("diffPreview");
const cardsList = document.getElementById("cardsList");
const reloadBtn = document.getElementById("reloadBtn");
const saveBtn = document.getElementById("saveBtn");

let currentSession = null;

function showMessage(text, type = "info") {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function hideMessage() {
  messageEl.className = "message hidden";
  messageEl.textContent = "";
}

function formatYen(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString("ja-JP")}円`;
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createStoreRow(shopName = "", highestPrice = "") {
  const row = document.createElement("div");
  row.className = "store-row";
  row.innerHTML = `
    <label>
      店名
      <input type="text" class="shop-name" placeholder="例: A店" value="${escapeHtml(shopName)}" />
    </label>
    <label>
      最高販売価格（円）
      <input type="number" min="0" step="1" class="highest-price" placeholder="例: 5980" value="${highestPrice}" />
    </label>
    <button type="button" class="danger small remove-store">削除</button>
  `;

  row.querySelector(".remove-store").addEventListener("click", () => {
    row.remove();
    updatePreview();
  });

  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", updatePreview);
  });

  storesContainer.appendChild(row);
}

function getStoreRows() {
  return [...storesContainer.querySelectorAll(".store-row")];
}

function collectStores() {
  return getStoreRows()
    .map((row) => {
      const shopName = row.querySelector(".shop-name").value.trim();
      const highestPrice = Number(
        row.querySelector(".highest-price").value || 0,
      );
      return { shopName, highestPrice };
    })
    .filter(
      (x) =>
        x.shopName && Number.isFinite(x.highestPrice) && x.highestPrice >= 0,
    );
}

function computeSummary(stores, appraisalPrice) {
  const maxStorePrice = stores.length
    ? Math.max(...stores.map((s) => Number(s.highestPrice || 0)))
    : 0;
  const diffPrice = maxStorePrice - Number(appraisalPrice || 0);
  return { maxStorePrice, diffPrice };
}

function updatePreview() {
  const stores = collectStores();
  const appraisalPrice = Number(appraisalInput.value || 0);
  const { maxStorePrice, diffPrice } = computeSummary(stores, appraisalPrice);
  maxPricePreview.textContent = formatYen(maxStorePrice);
  diffPreview.textContent = formatYen(diffPrice);
}

async function refreshSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    showMessage(error.message, "error");
    return;
  }
  currentSession = data.session;
  toggleUiBySession();
}

function toggleUiBySession() {
  const signedIn = !!currentSession?.user;
  authSection.classList.toggle("hidden", signedIn);
  appSection.classList.toggle("hidden", !signedIn);
  userArea.classList.toggle("hidden", !signedIn);
  userEmail.textContent = currentSession?.user?.email || "";

  if (signedIn) {
    loadCards();
  } else {
    cardsList.innerHTML = "";
  }
}

async function loginWithMagicLink(event) {
  event.preventDefault();
  hideMessage();

  const email = emailInput.value.trim();
  if (!email) return;

  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  const redirectUrl = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl },
  });

  submitButton.disabled = false;

  if (error) {
    showMessage(error.message, "error");
    return;
  }

  showMessage(
    "ログイン用メールを送信しました。メール内のリンクをこのURLに戻る形で開いてください。",
    "info",
  );
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showMessage(error.message, "error");
    return;
  }
  showMessage("ログアウトしました。", "info");
}

async function uploadImage(file, userId) {
  const safeName = sanitizeFileName(file.name);
  const filePath = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabaseClient.storage
    .from(BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;
  return filePath;
}

async function saveCard(event) {
  event.preventDefault();
  hideMessage();

  if (!currentSession?.user) {
    showMessage("先にログインしてください。", "error");
    return;
  }

  const file = imageInput.files?.[0];
  const cardName = cardNameInput.value.trim();
  const appraisalPrice = Number(appraisalInput.value);
  const stores = collectStores();

  if (!file) {
    showMessage("カード画像を選択してください。", "error");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showMessage("画像サイズは 6MB 以下にしてください。", "error");
    return;
  }
  if (!cardName) {
    showMessage("カード名を入力してください。", "error");
    return;
  }
  if (!Number.isFinite(appraisalPrice) || appraisalPrice < 0) {
    showMessage("査定後の価格を正しく入力してください。", "error");
    return;
  }
  if (stores.length === 0) {
    showMessage("店舗価格を1件以上入力してください。", "error");
    return;
  }

  saveBtn.disabled = true;

  try {
    const imagePath = await uploadImage(file, currentSession.user.id);

    const { data: cardRow, error: cardError } = await supabaseClient
      .from("cards")
      .insert({
        user_id: currentSession.user.id,
        card_name: cardName,
        appraisal_price: appraisalPrice,
        image_path: imagePath,
      })
      .select("id")
      .single();

    if (cardError) throw cardError;

    const priceRows = stores.map((store) => ({
      user_id: currentSession.user.id,
      card_id: cardRow.id,
      shop_name: store.shopName,
      highest_price: Number(store.highestPrice),
    }));

    const { error: priceError } = await supabaseClient
      .from("card_shop_prices")
      .insert(priceRows);

    if (priceError) throw priceError;

    cardForm.reset();
    storesContainer.innerHTML = "";
    createStoreRow();
    updatePreview();
    showMessage("保存しました。", "info");
    await loadCards();
  } catch (error) {
    showMessage(error.message || "保存に失敗しました。", "error");
  } finally {
    saveBtn.disabled = false;
  }
}

function buildCardHtml(card) {
  const stores = [...(card.card_shop_prices || [])].sort(
    (a, b) => Number(b.highest_price) - Number(a.highest_price),
  );
  const { maxStorePrice, diffPrice } = computeSummary(
    stores,
    card.appraisal_price,
  );
  const publicUrl = supabaseClient.storage
    .from(BUCKET)
    .getPublicUrl(card.image_path).data.publicUrl;

  const rows = stores
    .map(
      (store) => `
    <tr>
      <td>${escapeHtml(store.shop_name)}</td>
      <td>${formatYen(store.highest_price)}</td>
    </tr>
  `,
    )
    .join("");

  return `
    <article class="card-item">
      <img class="card-image" src="${publicUrl}" alt="${escapeHtml(card.card_name)}" />
      <div class="card-body">
        <div class="row between center">
          <div>
            <h3>${escapeHtml(card.card_name)}</h3>
            <p class="meta">登録日: ${new Date(card.created_at).toLocaleString("ja-JP")}</p>
          </div>
          <button type="button" class="danger small delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
        </div>

        <div class="price-grid">
          <div class="price-box">
            <div class="meta">査定後の価格</div>
            <strong>${formatYen(card.appraisal_price)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">店舗最高値</div>
            <strong>${formatYen(maxStorePrice)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">差額</div>
            <strong>${formatYen(diffPrice)}</strong>
          </div>
        </div>

        <table class="store-table">
          <thead>
            <tr>
              <th>店名</th>
              <th>最高販売価格</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

async function loadCards() {
  if (!currentSession?.user) return;

  cardsList.innerHTML = '<div class="empty">読み込み中...</div>';

  const { data, error } = await supabaseClient
    .from("cards")
    .select(
      `
      id,
      user_id,
      card_name,
      appraisal_price,
      image_path,
      created_at,
      card_shop_prices (
        id,
        shop_name,
        highest_price
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    showMessage(error.message, "error");
    cardsList.innerHTML = "";
    return;
  }

  if (!data || data.length === 0) {
    cardsList.innerHTML = '<div class="empty">まだ登録がありません。</div>';
    return;
  }

  cardsList.innerHTML = data.map(buildCardHtml).join("");

  cardsList.querySelectorAll(".delete-card").forEach((button) => {
    button.addEventListener("click", async () => {
      const cardId = button.dataset.cardId;
      const imagePath = button.dataset.imagePath;
      await deleteCard(cardId, imagePath);
    });
  });
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm("このカードデータを削除しますか？");
  if (!ok) return;

  try {
    const { error: fileError } = await supabaseClient.storage
      .from(BUCKET)
      .remove([imagePath]);
    if (fileError) {
      console.warn(fileError);
    }

    const { error: cardError } = await supabaseClient
      .from("cards")
      .delete()
      .eq("id", cardId);

    if (cardError) throw cardError;

    showMessage("削除しました。", "info");
    await loadCards();
  } catch (error) {
    showMessage(error.message || "削除に失敗しました。", "error");
  }
}

loginForm.addEventListener("submit", loginWithMagicLink);
signOutBtn.addEventListener("click", signOut);
cardForm.addEventListener("submit", saveCard);
addStoreBtn.addEventListener("click", () => createStoreRow());
appraisalInput.addEventListener("input", updatePreview);
reloadBtn.addEventListener("click", loadCards);

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  toggleUiBySession();
});

createStoreRow("店舗A", "");
refreshSession();
