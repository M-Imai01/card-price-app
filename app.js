const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.body.innerHTML = `
    <div style="max-width:720px;margin:40px auto;padding:24px;font-family:sans-serif;line-height:1.7;">
      <h1>config.js が見つからないか、設定値が空です</h1>
      <p>config.example.js を config.js にコピーし、Supabase の URL と publishable / anon key を設定してください。</p>
    </div>
  `
  throw new Error('Supabase config is missing')
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const BUCKET = 'card-images'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

const messageEl = document.getElementById('message')
const authSection = document.getElementById('authSection')
const appSection = document.getElementById('appSection')
const loginForm = document.getElementById('loginForm')
const emailInput = document.getElementById('emailInput')
const signOutBtn = document.getElementById('signOutBtn')
const userArea = document.getElementById('userArea')
const userEmail = document.getElementById('userEmail')
const cardForm = document.getElementById('cardForm')
const imageInput = document.getElementById('imageInput')
const cardNameInput = document.getElementById('cardNameInput')
const addStoreBtn = document.getElementById('addStoreBtn')
const storesContainer = document.getElementById('storesContainer')
const maxPricePreview = document.getElementById('maxPricePreview')
const maxAppraisalPreview = document.getElementById('maxAppraisalPreview')
const diffPreview = document.getElementById('diffPreview')
const cardsList = document.getElementById('cardsList')
const reloadBtn = document.getElementById('reloadBtn')
const saveBtn = document.getElementById('saveBtn')
const editModeBar = document.getElementById('editModeBar')
const editModeText = document.getElementById('editModeText')
const cancelEditBtn = document.getElementById('cancelEditBtn')

let currentSession = null
let editingCardId = null
let editingImagePath = null
let loadedCards = []

function showMessage(text, type = 'info') {
  messageEl.textContent = text
  messageEl.className = `message ${type}`
}

function hideMessage() {
  messageEl.className = 'message hidden'
  messageEl.textContent = ''
}

function formatYen(value) {
  const n = Number(value || 0)
  return `${n.toLocaleString('ja-JP')}円`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getDiffClass(value) {
  if (Number(value) < 0) return 'negative'
  if (Number(value) > 0) return 'positive'
  return ''
}

function computeMetrics(rows) {
  if (!rows.length) {
    return {
      maxStorePrice: 0,
      maxAppraisalPrice: 0,
      maxDiff: 0
    }
  }

  const maxStorePrice = Math.max(...rows.map((row) => Number(row.highestPrice || row.highest_price || 0)))
  const maxAppraisalPrice = Math.max(...rows.map((row) => Number(row.appraisalPrice || row.appraisal_price || 0)))
  const maxDiff = Math.max(
    ...rows.map((row) => Number(row.highestPrice || row.highest_price || 0) - Number(row.appraisalPrice || row.appraisal_price || 0))
  )

  return { maxStorePrice, maxAppraisalPrice, maxDiff }
}

function renderSummary(rows) {
  const metrics = computeMetrics(rows)
  maxPricePreview.textContent = formatYen(metrics.maxStorePrice)
  maxAppraisalPreview.textContent = formatYen(metrics.maxAppraisalPrice)
  diffPreview.textContent = formatYen(metrics.maxDiff)
  diffPreview.className = getDiffClass(metrics.maxDiff)
}

function createComparisonRow(values = {}) {
  const row = document.createElement('div')
  row.className = 'comparison-row'

  const shopName = values.shopName || values.shop_name || ''
  const highestPrice = values.highestPrice ?? values.highest_price ?? ''
  const appraisalPrice = values.appraisalPrice ?? values.appraisal_price ?? ''

  row.innerHTML = `
    <label>
      店名
      <input type="text" class="shop-name" placeholder="例: A店" value="${escapeHtml(shopName)}" />
    </label>
    <label>
      最高販売価格（円）
      <input type="number" min="0" step="1" class="highest-price" placeholder="例: 5980" value="${highestPrice}" />
    </label>
    <label>
      査定後の価格（円）
      <input type="number" min="0" step="1" class="appraisal-price" placeholder="例: 4200" value="${appraisalPrice}" />
    </label>
    <div class="row-diff-box">
      <span class="label">差額</span>
      <strong class="row-diff-value">0円</strong>
    </div>
    <button type="button" class="danger small remove-store">削除</button>
  `

  const updateRowDiff = () => {
    const sale = Number(row.querySelector('.highest-price').value || 0)
    const appraisal = Number(row.querySelector('.appraisal-price').value || 0)
    const diff = sale - appraisal
    const diffEl = row.querySelector('.row-diff-value')
    diffEl.textContent = formatYen(diff)
    diffEl.className = `row-diff-value ${getDiffClass(diff)}`.trim()
    updatePreview()
  }

  row.querySelector('.remove-store').addEventListener('click', () => {
    row.remove()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRowDiff)
  })

  storesContainer.appendChild(row)
  updateRowDiff()
}

function getComparisonRows() {
  return [...storesContainer.querySelectorAll('.comparison-row')]
}

function collectRows() {
  return getComparisonRows()
    .map((row) => {
      const shopName = row.querySelector('.shop-name').value.trim()
      const highestPrice = Number(row.querySelector('.highest-price').value || 0)
      const appraisalPrice = Number(row.querySelector('.appraisal-price').value || 0)
      return { shopName, highestPrice, appraisalPrice }
    })
    .filter((row) => row.shopName && Number.isFinite(row.highestPrice) && row.highestPrice >= 0 && Number.isFinite(row.appraisalPrice) && row.appraisalPrice >= 0)
}

function updatePreview() {
  renderSummary(collectRows())
}

function resetFormToCreateMode() {
  editingCardId = null
  editingImagePath = null
  cardForm.reset()
  storesContainer.innerHTML = ''
  createComparisonRow()
  saveBtn.textContent = 'カードを登録'
  editModeBar.classList.add('hidden')
  hideMessage()
}

function startEditMode(cardId) {
  const card = loadedCards.find((item) => item.id === cardId)
  if (!card) return

  editingCardId = card.id
  editingImagePath = card.image_path
  cardNameInput.value = card.card_name || ''
  storesContainer.innerHTML = ''

  const rows = (card.card_shop_prices || []).length
    ? card.card_shop_prices
    : [{ shop_name: '店舗A', highest_price: 0, appraisal_price: card.appraisal_price || 0 }]

  rows.forEach((row) => createComparisonRow(row))
  updatePreview()

  saveBtn.textContent = '変更を保存'
  editModeText.textContent = `「${card.card_name}」を編集中です。画像を変えない場合はそのまま保存できます。`
  editModeBar.classList.remove('hidden')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function refreshSession() {
  const { data, error } = await supabaseClient.auth.getSession()
  if (error) {
    showMessage(error.message, 'error')
    return
  }
  currentSession = data.session
  toggleUiBySession()
}

function toggleUiBySession() {
  const signedIn = !!currentSession?.user
  authSection.classList.toggle('hidden', signedIn)
  appSection.classList.toggle('hidden', !signedIn)
  userArea.classList.toggle('hidden', !signedIn)
  userEmail.textContent = currentSession?.user?.email || ''

  if (signedIn) {
    loadCards()
  } else {
    cardsList.innerHTML = ''
    loadedCards = []
    resetFormToCreateMode()
  }
}

async function loginWithMagicLink(event) {
  event.preventDefault()
  hideMessage()

  const email = emailInput.value.trim()
  if (!email) return

  const submitButton = loginForm.querySelector('button[type="submit"]')
  submitButton.disabled = true

  const redirectUrl = `${window.location.origin}${window.location.pathname}`
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl }
  })

  submitButton.disabled = false

  if (error) {
    showMessage(error.message, 'error')
    return
  }

  showMessage('ログイン用メールを送信しました。メール内のリンクをこのURLに戻る形で開いてください。', 'info')
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut()
  if (error) {
    showMessage(error.message, 'error')
    return
  }
  showMessage('ログアウトしました。', 'info')
}

async function uploadImage(file, userId) {
  const safeName = sanitizeFileName(file.name)
  const filePath = `${userId}/${crypto.randomUUID()}-${safeName}`

  const { error } = await supabaseClient.storage
    .from(BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    })

  if (error) throw error
  return filePath
}

async function saveCard(event) {
  event.preventDefault()
  hideMessage()

  if (!currentSession?.user) {
    showMessage('先にログインしてください。', 'error')
    return
  }

  const file = imageInput.files?.[0]
  const cardName = cardNameInput.value.trim()
  const rows = collectRows()
  const metrics = computeMetrics(rows)

  if (!cardName) {
    showMessage('カード名を入力してください。', 'error')
    return
  }
  if (!editingCardId && !file) {
    showMessage('新規登録時はカード画像を選択してください。', 'error')
    return
  }
  if (file && file.size > MAX_IMAGE_BYTES) {
    showMessage('画像サイズは 6MB 以下にしてください。', 'error')
    return
  }
  if (rows.length === 0) {
    showMessage('店舗情報を1件以上入力してください。', 'error')
    return
  }

  saveBtn.disabled = true

  try {
    let imagePath = editingImagePath

    if (file) {
      imagePath = await uploadImage(file, currentSession.user.id)
    }

    if (editingCardId) {
      const { error: updateError } = await supabaseClient
        .from('cards')
        .update({
          card_name: cardName,
          appraisal_price: metrics.maxAppraisalPrice,
          image_path: imagePath,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingCardId)

      if (updateError) throw updateError

      const { error: deleteOldRowsError } = await supabaseClient
        .from('card_shop_prices')
        .delete()
        .eq('card_id', editingCardId)

      if (deleteOldRowsError) throw deleteOldRowsError

      const replacementRows = rows.map((row) => ({
        user_id: currentSession.user.id,
        card_id: editingCardId,
        shop_name: row.shopName,
        highest_price: row.highestPrice,
        appraisal_price: row.appraisalPrice
      }))

      const { error: insertRowsError } = await supabaseClient
        .from('card_shop_prices')
        .insert(replacementRows)

      if (insertRowsError) throw insertRowsError

      if (file && editingImagePath && editingImagePath !== imagePath) {
        const { error: removeOldFileError } = await supabaseClient.storage.from(BUCKET).remove([editingImagePath])
        if (removeOldFileError) {
          console.warn(removeOldFileError)
        }
      }

      showMessage('カード情報を更新しました。', 'info')
    } else {
      const { data: cardRow, error: cardError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          card_name: cardName,
          appraisal_price: metrics.maxAppraisalPrice,
          image_path: imagePath
        })
        .select('id')
        .single()

      if (cardError) throw cardError

      const priceRows = rows.map((row) => ({
        user_id: currentSession.user.id,
        card_id: cardRow.id,
        shop_name: row.shopName,
        highest_price: row.highestPrice,
        appraisal_price: row.appraisalPrice
      }))

      const { error: priceError } = await supabaseClient
        .from('card_shop_prices')
        .insert(priceRows)

      if (priceError) throw priceError

      showMessage('保存しました。', 'info')
    }

    resetFormToCreateMode()
    await loadCards()
  } catch (error) {
    showMessage(error.message || '保存に失敗しました。', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

function buildTableRows(rows) {
  return rows.map((row) => {
    const diff = Number(row.highest_price || 0) - Number(row.appraisal_price || 0)
    const diffClass = diff < 0 ? 'diff-negative' : diff > 0 ? 'diff-positive' : ''
    return `
      <tr>
        <td>${escapeHtml(row.shop_name)}</td>
        <td>${formatYen(row.highest_price)}</td>
        <td>${formatYen(row.appraisal_price)}</td>
        <td class="${diffClass}">${formatYen(diff)}</td>
      </tr>
    `
  }).join('')
}

function buildCardHtml(card) {
  const rows = [...(card.card_shop_prices || [])].sort((a, b) => Number(b.highest_price) - Number(a.highest_price))
  const metrics = computeMetrics(rows)
  const publicUrl = supabaseClient.storage.from(BUCKET).getPublicUrl(card.image_path).data.publicUrl
  const maxDiffClass = metrics.maxDiff < 0 ? 'diff-negative' : metrics.maxDiff > 0 ? 'diff-positive' : ''

  return `
    <article class="card-item" data-card-id="${card.id}">
      <img class="card-image" src="${publicUrl}" alt="${escapeHtml(card.card_name)}" />
      <div class="card-body">
        <div class="row between center">
          <div>
            <h3>${escapeHtml(card.card_name)}</h3>
            <p class="meta">登録日: ${new Date(card.created_at).toLocaleString('ja-JP')}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small edit-card" data-card-id="${card.id}">編集</button>
            <button type="button" class="danger small delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
          </div>
        </div>

        <div class="price-grid">
          <div class="price-box">
            <div class="meta">最高販売価格</div>
            <strong>${formatYen(metrics.maxStorePrice)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最高査定価格</div>
            <strong>${formatYen(metrics.maxAppraisalPrice)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最大差額</div>
            <strong class="${maxDiffClass}">${formatYen(metrics.maxDiff)}</strong>
          </div>
        </div>

        <table class="store-table">
          <thead>
            <tr>
              <th>店名</th>
              <th>最高販売価格</th>
              <th>査定後の価格</th>
              <th>差額</th>
            </tr>
          </thead>
          <tbody>
            ${buildTableRows(rows)}
          </tbody>
        </table>
      </div>
    </article>
  `
}

async function loadCards() {
  if (!currentSession?.user) return

  cardsList.innerHTML = '<div class="empty">読み込み中...</div>'

  const { data, error } = await supabaseClient
    .from('cards')
    .select(`
      id,
      user_id,
      card_name,
      appraisal_price,
      image_path,
      created_at,
      updated_at,
      card_shop_prices (
        id,
        shop_name,
        highest_price,
        appraisal_price
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    showMessage(error.message, 'error')
    cardsList.innerHTML = ''
    return
  }

  loadedCards = data || []

  if (!loadedCards.length) {
    cardsList.innerHTML = '<div class="empty">まだ登録がありません。</div>'
    return
  }

  cardsList.innerHTML = loadedCards.map(buildCardHtml).join('')

  cardsList.querySelectorAll('.delete-card').forEach((button) => {
    button.addEventListener('click', async () => {
      const cardId = button.dataset.cardId
      const imagePath = button.dataset.imagePath
      await deleteCard(cardId, imagePath)
    })
  })

  cardsList.querySelectorAll('.edit-card').forEach((button) => {
    button.addEventListener('click', () => {
      startEditMode(button.dataset.cardId)
    })
  })
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm('このカードデータを削除しますか？')
  if (!ok) return

  try {
    const { error: fileError } = await supabaseClient.storage.from(BUCKET).remove([imagePath])
    if (fileError) {
      console.warn(fileError)
    }

    const { error: cardError } = await supabaseClient
      .from('cards')
      .delete()
      .eq('id', cardId)

    if (cardError) throw cardError

    if (editingCardId === cardId) {
      resetFormToCreateMode()
    }

    showMessage('削除しました。', 'info')
    await loadCards()
  } catch (error) {
    showMessage(error.message || '削除に失敗しました。', 'error')
  }
}

loginForm.addEventListener('submit', loginWithMagicLink)
signOutBtn.addEventListener('click', signOut)
cardForm.addEventListener('submit', saveCard)
addStoreBtn.addEventListener('click', () => createComparisonRow())
reloadBtn.addEventListener('click', loadCards)
cancelEditBtn.addEventListener('click', resetFormToCreateMode)

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  toggleUiBySession()
})

createComparisonRow({ shop_name: '店舗A' })
refreshSession()
