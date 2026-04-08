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
const groupNameInput = document.getElementById('groupNameInput')
const groupSuggestions = document.getElementById('groupSuggestions')
const imageInput = document.getElementById('imageInput')
const cardNameInput = document.getElementById('cardNameInput')
const baselinesContainer = document.getElementById('baselinesContainer')
const appraisalsContainer = document.getElementById('appraisalsContainer')
const addBaselineBtn = document.getElementById('addBaselineBtn')
const addAppraisalBtn = document.getElementById('addAppraisalBtn')
const baselinePreview = document.getElementById('baselinePreview')
const maxAppraisalPreview = document.getElementById('maxAppraisalPreview')
const gapPreview = document.getElementById('gapPreview')
const groupsList = document.getElementById('groupsList')
const reloadBtn = document.getElementById('reloadBtn')
const saveBtn = document.getElementById('saveBtn')
const editModeBar = document.getElementById('editModeBar')
const editModeText = document.getElementById('editModeText')
const cancelEditBtn = document.getElementById('cancelEditBtn')

let currentSession = null
let editingCardId = null
let editingImagePath = null
let loadedGroups = []
let loadedCards = []

function showMessage(text, type = 'info') {
  messageEl.textContent = text
  messageEl.className = `message ${type}`
}

function hideMessage() {
  messageEl.textContent = ''
  messageEl.className = 'message hidden'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatYen(value) {
  return `${Number(value || 0).toLocaleString('ja-JP')}円`
}

function sanitizeFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function calcTotal(price, quantity) {
  return Number(price || 0) * Number(quantity || 0)
}

function baselineLabel(index) {
  if (index === 0) return '基準とする最大価格'
  if (index === 1) return '参考にする価格'
  return `参考にする価格${index}`
}

function sortBaselines(items) {
  return [...(items || [])].sort((a, b) => {
    const labelDiff = Number(a.label_order || 0) - Number(b.label_order || 0)
    if (labelDiff !== 0) return labelDiff
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  })
}

function sortAppraisals(items) {
  return [...(items || [])].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
}

function computeMetrics(baselines, appraisals) {
  const normalizedBaselines = sortBaselines(baselines).map((row, index) => ({
    ...row,
    label: baselineLabel(index),
    total: calcTotal(row.reference_price ?? row.referencePrice, row.quantity)
  }))
  const normalizedAppraisals = sortAppraisals(appraisals).map((row) => ({
    ...row,
    total: calcTotal(row.appraisal_price ?? row.appraisalPrice, row.quantity)
  }))

  const bestBaseline = normalizedBaselines.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)
  const bestAppraisal = normalizedAppraisals.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)

  return {
    baselines: normalizedBaselines,
    appraisals: normalizedAppraisals,
    bestBaseline,
    bestAppraisal,
    baselineMaxTotal: bestBaseline?.total ?? 0,
    maxAppraisalTotal: bestAppraisal?.total ?? 0,
    gap: (bestBaseline?.total ?? 0) - (bestAppraisal?.total ?? 0)
  }
}

function updateGroupSuggestions() {
  groupSuggestions.innerHTML = loadedGroups
    .map((group) => `<option value="${escapeHtml(group.group_name)}"></option>`)
    .join('')
}

function renumberBaselineRows() {
  ;[...baselinesContainer.querySelectorAll('.baseline-row')].forEach((row, index) => {
    const title = row.querySelector('.baseline-row-title')
    if (title) title.textContent = baselineLabel(index)
  })
}

function createBaselineRow(data = {}) {
  const row = document.createElement('div')
  row.className = 'entry-row baseline-row'
  row.innerHTML = `
    <div class="entry-row-top row between center wrap-gap">
      <strong class="baseline-row-title"></strong>
      <button type="button" class="danger small remove-entry">削除</button>
    </div>
    <div class="entry-grid baseline-entry-grid">
      <label>
        店舗名
        <input type="text" class="baseline-shop-name" placeholder="例: A店" value="${escapeHtml(data.shop_name || data.shopName || '')}" />
      </label>
      <label>
        金額（円）
        <input type="number" min="0" step="1" class="baseline-price" placeholder="例: 5980" value="${Number(data.reference_price ?? data.referencePrice ?? 0) || ''}" />
      </label>
      <label>
        数量
        <input type="number" min="1" step="1" class="baseline-quantity" placeholder="1" value="${Number(data.quantity || 1)}" />
      </label>
      <div class="inline-total-box">
        <span class="meta">総額</span>
        <strong class="baseline-total">0円</strong>
      </div>
    </div>
  `

  const updateRowTotal = () => {
    const price = Number(row.querySelector('.baseline-price').value || 0)
    const quantity = Math.max(1, Number(row.querySelector('.baseline-quantity').value || 1))
    row.querySelector('.baseline-total').textContent = formatYen(calcTotal(price, quantity))
    updatePreview()
  }

  row.querySelector('.remove-entry').addEventListener('click', () => {
    row.remove()
    renumberBaselineRows()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRowTotal)
  })

  baselinesContainer.appendChild(row)
  renumberBaselineRows()
  updateRowTotal()
}

function createAppraisalRow(data = {}) {
  const row = document.createElement('div')
  row.className = 'entry-row appraisal-row'
  row.innerHTML = `
    <div class="entry-row-top row between center wrap-gap">
      <strong>査定価格</strong>
      <button type="button" class="danger small remove-entry">削除</button>
    </div>
    <div class="entry-grid appraisal-entry-grid">
      <label>
        店舗名
        <input type="text" class="appraisal-shop-name" placeholder="例: B店" value="${escapeHtml(data.shop_name || data.shopName || '')}" />
      </label>
      <label>
        査定価格（円）
        <input type="number" min="0" step="1" class="appraisal-price" placeholder="例: 4200" value="${Number(data.appraisal_price ?? data.appraisalPrice ?? 0) || ''}" />
      </label>
      <label>
        数量
        <input type="number" min="1" step="1" class="appraisal-quantity" placeholder="1" value="${Number(data.quantity || 1)}" />
      </label>
      <div class="inline-total-box">
        <span class="meta">総額</span>
        <strong class="appraisal-total">0円</strong>
      </div>
    </div>
  `

  const updateRowTotal = () => {
    const price = Number(row.querySelector('.appraisal-price').value || 0)
    const quantity = Math.max(1, Number(row.querySelector('.appraisal-quantity').value || 1))
    row.querySelector('.appraisal-total').textContent = formatYen(calcTotal(price, quantity))
    updatePreview()
  }

  row.querySelector('.remove-entry').addEventListener('click', () => {
    row.remove()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRowTotal)
  })

  appraisalsContainer.appendChild(row)
  updateRowTotal()
}

function collectBaselines() {
  return [...baselinesContainer.querySelectorAll('.baseline-row')]
    .map((row, index) => ({
      label_order: index + 1,
      shop_name: row.querySelector('.baseline-shop-name').value.trim(),
      reference_price: Number(row.querySelector('.baseline-price').value || 0),
      quantity: Math.max(1, Number(row.querySelector('.baseline-quantity').value || 1))
    }))
    .filter((row) => row.shop_name && Number.isFinite(row.reference_price) && row.reference_price >= 0 && Number.isFinite(row.quantity) && row.quantity >= 1)
}

function collectAppraisals() {
  return [...appraisalsContainer.querySelectorAll('.appraisal-row')]
    .map((row) => ({
      shop_name: row.querySelector('.appraisal-shop-name').value.trim(),
      appraisal_price: Number(row.querySelector('.appraisal-price').value || 0),
      quantity: Math.max(1, Number(row.querySelector('.appraisal-quantity').value || 1))
    }))
    .filter((row) => row.shop_name && Number.isFinite(row.appraisal_price) && row.appraisal_price >= 0 && Number.isFinite(row.quantity) && row.quantity >= 1)
}

function updatePreview() {
  const metrics = computeMetrics(collectBaselines(), collectAppraisals())
  baselinePreview.textContent = formatYen(metrics.baselineMaxTotal)
  maxAppraisalPreview.textContent = formatYen(metrics.maxAppraisalTotal)
  gapPreview.textContent = formatYen(metrics.gap)
}

function resetFormToCreateMode() {
  editingCardId = null
  editingImagePath = null
  cardForm.reset()
  baselinesContainer.innerHTML = ''
  appraisalsContainer.innerHTML = ''
  createBaselineRow()
  createAppraisalRow()
  saveBtn.textContent = 'カードを登録'
  editModeBar.classList.add('hidden')
  updatePreview()
}

function startEditMode(cardId) {
  const card = loadedCards.find((item) => item.id === cardId)
  if (!card) return

  editingCardId = card.id
  editingImagePath = card.image_path
  groupNameInput.value = card.group_name || '未分類'
  cardNameInput.value = card.card_name || ''
  baselinesContainer.innerHTML = ''
  appraisalsContainer.innerHTML = ''

  sortBaselines(card.card_baselines).forEach((row) => createBaselineRow(row))
  sortAppraisals(card.card_appraisals).forEach((row) => createAppraisalRow(row))

  if (!card.card_baselines?.length) createBaselineRow()
  if (!card.card_appraisals?.length) createAppraisalRow()

  saveBtn.textContent = '変更を保存'
  editModeText.textContent = `「${card.card_name}」を編集中です。画像を変えない場合はそのまま保存できます。`
  editModeBar.classList.remove('hidden')
  updatePreview()
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
    loadAllData()
  } else {
    groupsList.innerHTML = ''
    loadedCards = []
    loadedGroups = []
    updateGroupSuggestions()
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

  showMessage('ログイン用メールを送信しました。メール内のリンクからこの画面へ戻ってください。', 'info')
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
    .upload(filePath, file, { cacheControl: '3600', upsert: false })

  if (error) throw error
  return filePath
}

async function removeImageIfUnused(imagePath, excludingCardId = null) {
  if (!imagePath) return

  let query = supabaseClient
    .from('cards')
    .select('id', { count: 'exact', head: false })
    .eq('image_path', imagePath)

  if (excludingCardId) {
    query = query.neq('id', excludingCardId)
  }

  const { data, error } = await query
  if (error) {
    console.warn(error)
    return
  }

  if ((data || []).length === 0) {
    const { error: removeError } = await supabaseClient.storage.from(BUCKET).remove([imagePath])
    if (removeError) console.warn(removeError)
  }
}

async function ensureGroup(groupName) {
  const trimmed = groupName.trim()
  const found = loadedGroups.find((group) => group.group_name === trimmed)
  if (found) return found

  const now = new Date().toISOString()
  const { data, error } = await supabaseClient
    .from('appraisal_groups')
    .insert({
      user_id: currentSession.user.id,
      group_name: trimmed,
      created_at: now,
      updated_at: now
    })
    .select('id, group_name, created_at, updated_at')
    .single()

  if (error) throw error
  loadedGroups.push(data)
  updateGroupSuggestions()
  return data
}

function getGroupNameById(groupId) {
  return loadedGroups.find((group) => group.id === groupId)?.group_name || '未分類'
}

async function saveCard(event) {
  event.preventDefault()
  hideMessage()

  if (!currentSession?.user) {
    showMessage('先にログインしてください。', 'error')
    return
  }

  const groupName = groupNameInput.value.trim()
  const cardName = cardNameInput.value.trim()
  const baselines = collectBaselines()
  const appraisals = collectAppraisals()
  const metrics = computeMetrics(baselines, appraisals)
  const firstBaseline = baselines[0] || { shop_name: '', reference_price: 0 }
  const file = imageInput.files?.[0]

  if (!groupName) {
    showMessage('カードグループを入力してください。', 'error')
    return
  }
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
  if (baselines.length === 0) {
    showMessage('基準とする最大価格を1件以上入力してください。', 'error')
    return
  }

  saveBtn.disabled = true

  try {
    const group = await ensureGroup(groupName)
    let imagePath = editingImagePath

    if (file) {
      imagePath = await uploadImage(file, currentSession.user.id)
    }

    if (editingCardId) {
      const { error: updateCardError } = await supabaseClient
        .from('cards')
        .update({
          group_id: group.id,
          card_name: cardName,
          image_path: imagePath,
          appraisal_price: 0,
          baseline_shop_name: firstBaseline.shop_name,
          baseline_highest_price: firstBaseline.reference_price,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingCardId)

      if (updateCardError) throw updateCardError

      const { error: deleteBaselinesError } = await supabaseClient
        .from('card_baselines')
        .delete()
        .eq('card_id', editingCardId)
      if (deleteBaselinesError) throw deleteBaselinesError

      const { error: deleteAppraisalsError } = await supabaseClient
        .from('card_appraisals')
        .delete()
        .eq('card_id', editingCardId)
      if (deleteAppraisalsError) throw deleteAppraisalsError

      if (baselines.length) {
        const { error: insertBaselinesError } = await supabaseClient
          .from('card_baselines')
          .insert(baselines.map((row) => ({
            user_id: currentSession.user.id,
            card_id: editingCardId,
            label_order: row.label_order,
            shop_name: row.shop_name,
            reference_price: row.reference_price,
            quantity: row.quantity,
            updated_at: new Date().toISOString()
          })))
        if (insertBaselinesError) throw insertBaselinesError
      }

      if (appraisals.length) {
        const { error: insertAppraisalsError } = await supabaseClient
          .from('card_appraisals')
          .insert(appraisals.map((row) => ({
            user_id: currentSession.user.id,
            card_id: editingCardId,
            shop_name: row.shop_name,
            appraisal_price: row.appraisal_price,
            quantity: row.quantity,
            updated_at: new Date().toISOString()
          })))
        if (insertAppraisalsError) throw insertAppraisalsError
      }

      if (file && editingImagePath && editingImagePath !== imagePath) {
        await removeImageIfUnused(editingImagePath, editingCardId)
      }

      showMessage('カード情報を更新しました。', 'info')
    } else {
      const { data: insertedCard, error: insertCardError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          group_id: group.id,
          card_name: cardName,
          appraisal_price: 0,
          image_path: imagePath,
          baseline_shop_name: firstBaseline.shop_name,
          baseline_highest_price: firstBaseline.reference_price,
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (insertCardError) throw insertCardError

      const { error: insertBaselinesError } = await supabaseClient
        .from('card_baselines')
        .insert(baselines.map((row) => ({
          user_id: currentSession.user.id,
          card_id: insertedCard.id,
          label_order: row.label_order,
          shop_name: row.shop_name,
          reference_price: row.reference_price,
          quantity: row.quantity,
          updated_at: new Date().toISOString()
        })))
      if (insertBaselinesError) throw insertBaselinesError

      if (appraisals.length) {
        const { error: insertAppraisalsError } = await supabaseClient
          .from('card_appraisals')
          .insert(appraisals.map((row) => ({
            user_id: currentSession.user.id,
            card_id: insertedCard.id,
            shop_name: row.shop_name,
            appraisal_price: row.appraisal_price,
            quantity: row.quantity,
            updated_at: new Date().toISOString()
          })))
        if (insertAppraisalsError) throw insertAppraisalsError
      }

      showMessage('カードを保存しました。', 'info')
    }

    resetFormToCreateMode()
    await loadAllData()
  } catch (error) {
    showMessage(error.message || '保存に失敗しました。', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

function buildBaselineMiniItems(card) {
  return computeMetrics(card.card_baselines, card.card_appraisals).baselines
    .map((row) => `
      <div class="mini-item baseline-mini">
        <div class="mini-label">${escapeHtml(row.label)}</div>
        <div class="mini-shop">${escapeHtml(row.shop_name)}</div>
        <div class="mini-meta">単価 ${formatYen(row.reference_price)} / ×${row.quantity}</div>
        <div class="mini-value">${formatYen(row.total)}</div>
      </div>
    `)
    .join('')
}

function buildAppraisalRows(card) {
  const metrics = computeMetrics(card.card_baselines, card.card_appraisals)
  return metrics.appraisals.length
    ? metrics.appraisals.map((row) => `
      <tr>
        <td>${escapeHtml(row.shop_name)}</td>
        <td>${formatYen(row.appraisal_price)}</td>
        <td>×${row.quantity}</td>
        <td>${formatYen(row.total)}</td>
        <td>${formatYen(metrics.baselineMaxTotal - row.total)}</td>
      </tr>
    `).join('')
    : `
      <tr>
        <td colspan="5" class="empty-cell">まだ査定価格の登録がありません。</td>
      </tr>
    `
}

function buildCardHtml(card) {
  const metrics = computeMetrics(card.card_baselines, card.card_appraisals)
  const publicUrl = supabaseClient.storage.from(BUCKET).getPublicUrl(card.image_path).data.publicUrl

  return `
    <article class="card-item" data-card-id="${card.id}">
      <div class="card-image-wrap">
        <img class="card-image" src="${publicUrl}" alt="${escapeHtml(card.card_name)}" />
      </div>
      <div class="card-body">
        <div class="row between center wrap-gap">
          <div>
            <h3 class="card-title">${escapeHtml(card.card_name)}</h3>
            <p class="meta">更新日: ${new Date(card.updated_at || card.created_at).toLocaleString('ja-JP')}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small edit-card" data-card-id="${card.id}">編集</button>
            <button type="button" class="secondary small duplicate-card" data-card-id="${card.id}">複製</button>
            <button type="button" class="danger small delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
          </div>
        </div>

        <div class="card-summary">
          <div class="price-box">
            <div class="meta">基準とする最大価格</div>
            <strong class="price-value">${formatYen(metrics.baselineMaxTotal)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最高査定価格</div>
            <strong class="price-value accent-red">${formatYen(metrics.maxAppraisalTotal)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最大差額</div>
            <strong class="price-value">${formatYen(metrics.gap)}</strong>
          </div>
        </div>

        <section class="mini-section">
          <div class="section-kicker">基準とする価格</div>
          <div class="baseline-mini-grid">
            ${buildBaselineMiniItems(card)}
          </div>
        </section>

        <section class="table-section">
          <div class="section-kicker">実際の査定価格</div>
          <div class="table-wrap">
            <table class="store-table">
              <thead>
                <tr>
                  <th>店舗名</th>
                  <th>単価</th>
                  <th>数量</th>
                  <th>総額</th>
                  <th>基準との差額</th>
                </tr>
              </thead>
              <tbody>
                ${buildAppraisalRows(card)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </article>
  `
}

function buildGroupHtml(group) {
  const cards = [...group.cards].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
  const totals = cards.reduce((acc, card) => {
    const metrics = computeMetrics(card.card_baselines, card.card_appraisals)
    acc.baseline += metrics.baselineMaxTotal
    acc.appraisal += metrics.maxAppraisalTotal
    acc.gap += metrics.gap
    return acc
  }, { baseline: 0, appraisal: 0, gap: 0 })

  return `
    <section class="group-block" data-group-id="${group.id || ''}">
      <div class="group-head row between center wrap-gap">
        <div>
          <div class="group-label">カードグループ：<span>${escapeHtml(group.group_name)}</span></div>
          <p class="meta">カード枚数: ${cards.length}件</p>
        </div>
        <div class="group-actions">
          ${group.id ? `<button type="button" class="secondary small rename-group" data-group-id="${group.id}">グループ名を変更</button>` : ''}
          ${group.id ? `<button type="button" class="secondary small duplicate-group" data-group-id="${group.id}">グループを複製</button>` : ''}
        </div>
      </div>

      <div class="summary-box summary-grid three group-summary-box">
        <div>
          <div class="meta">基準とする最大価格 合計</div>
          <strong>${formatYen(totals.baseline)}</strong>
        </div>
        <div>
          <div class="meta">最高査定価格 合計</div>
          <strong class="accent-red">${formatYen(totals.appraisal)}</strong>
        </div>
        <div>
          <div class="meta">最大差額 合計</div>
          <strong>${formatYen(totals.gap)}</strong>
        </div>
      </div>

      <div class="cards-grid">
        ${cards.map(buildCardHtml).join('')}
      </div>
    </section>
  `
}

function bindRenderedButtons() {
  groupsList.querySelectorAll('.edit-card').forEach((button) => {
    button.addEventListener('click', () => startEditMode(button.dataset.cardId))
  })

  groupsList.querySelectorAll('.delete-card').forEach((button) => {
    button.addEventListener('click', () => deleteCard(button.dataset.cardId, button.dataset.imagePath))
  })

  groupsList.querySelectorAll('.duplicate-card').forEach((button) => {
    button.addEventListener('click', () => duplicateCard(button.dataset.cardId))
  })

  groupsList.querySelectorAll('.duplicate-group').forEach((button) => {
    button.addEventListener('click', () => duplicateGroup(button.dataset.groupId))
  })

  groupsList.querySelectorAll('.rename-group').forEach((button) => {
    button.addEventListener('click', () => renameGroup(button.dataset.groupId))
  })
}

function renderGroups() {
  if (!loadedCards.length) {
    groupsList.innerHTML = '<div class="empty">まだ登録がありません。</div>'
    return
  }

  const groupsById = new Map()

  loadedGroups.forEach((group) => {
    groupsById.set(group.id, { ...group, cards: [] })
  })

  loadedCards.forEach((card) => {
    const key = card.group_id || '__ungrouped__'
    if (!groupsById.has(key)) {
      groupsById.set(key, {
        id: null,
        group_name: '未分類',
        cards: []
      })
    }
    groupsById.get(key).cards.push(card)
  })

  const orderedGroups = [...groupsById.values()].filter((group) => group.cards.length > 0)
  orderedGroups.sort((a, b) => {
    const aLatest = Math.max(...a.cards.map((card) => new Date(card.updated_at || card.created_at).getTime()))
    const bLatest = Math.max(...b.cards.map((card) => new Date(card.updated_at || card.created_at).getTime()))
    return bLatest - aLatest
  })

  groupsList.innerHTML = orderedGroups.map(buildGroupHtml).join('')
  bindRenderedButtons()
}

async function loadAllData() {
  if (!currentSession?.user) return

  groupsList.innerHTML = '<div class="empty">読み込み中...</div>'

  const [groupsResult, cardsResult] = await Promise.all([
    supabaseClient
      .from('appraisal_groups')
      .select('id, group_name, created_at, updated_at')
      .order('updated_at', { ascending: false }),
    supabaseClient
      .from('cards')
      .select(`
        id,
        user_id,
        group_id,
        card_name,
        image_path,
        created_at,
        updated_at,
        card_baselines (
          id,
          label_order,
          shop_name,
          reference_price,
          quantity,
          created_at,
          updated_at
        ),
        card_appraisals (
          id,
          shop_name,
          appraisal_price,
          quantity,
          created_at,
          updated_at
        )
      `)
      .order('updated_at', { ascending: false })
  ])

  if (groupsResult.error) {
    showMessage(groupsResult.error.message, 'error')
    groupsList.innerHTML = ''
    return
  }
  if (cardsResult.error) {
    showMessage(cardsResult.error.message, 'error')
    groupsList.innerHTML = ''
    return
  }

  loadedGroups = groupsResult.data || []
  loadedCards = (cardsResult.data || []).map((card) => ({
    ...card,
    group_name: getGroupNameById(card.group_id),
    card_baselines: sortBaselines(card.card_baselines),
    card_appraisals: sortAppraisals(card.card_appraisals)
  }))

  updateGroupSuggestions()
  renderGroups()
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm('このカードを削除しますか？')
  if (!ok) return

  try {
    const { error } = await supabaseClient
      .from('cards')
      .delete()
      .eq('id', cardId)

    if (error) throw error

    await removeImageIfUnused(imagePath, cardId)

    if (editingCardId === cardId) {
      resetFormToCreateMode()
    }

    showMessage('カードを削除しました。', 'info')
    await loadAllData()
  } catch (error) {
    showMessage(error.message || '削除に失敗しました。', 'error')
  }
}

function nextCopyName(baseName, usedNames) {
  if (!usedNames.has(`${baseName} コピー`)) return `${baseName} コピー`

  let i = 2
  while (usedNames.has(`${baseName} コピー${i}`)) {
    i += 1
  }
  return `${baseName} コピー${i}`
}

async function duplicateCard(cardId, targetGroupId = null) {
  const card = loadedCards.find((item) => item.id === cardId)
  if (!card) return

  const usedNames = new Set(loadedCards.filter((item) => item.group_id === (targetGroupId || card.group_id)).map((item) => item.card_name))
  const duplicatedName = nextCopyName(card.card_name, usedNames)
  const firstBaseline = sortBaselines(card.card_baselines)[0] || { shop_name: '', reference_price: 0 }

  try {
    const { data: insertedCard, error: insertCardError } = await supabaseClient
      .from('cards')
      .insert({
        user_id: currentSession.user.id,
        group_id: targetGroupId || card.group_id,
        card_name: duplicatedName,
        appraisal_price: 0,
        image_path: card.image_path,
        baseline_shop_name: firstBaseline.shop_name,
        baseline_highest_price: firstBaseline.reference_price,
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single()

    if (insertCardError) throw insertCardError

    if (card.card_baselines.length) {
      const { error: baselineError } = await supabaseClient
        .from('card_baselines')
        .insert(sortBaselines(card.card_baselines).map((row, index) => ({
          user_id: currentSession.user.id,
          card_id: insertedCard.id,
          label_order: index + 1,
          shop_name: row.shop_name,
          reference_price: row.reference_price,
          quantity: row.quantity,
          updated_at: new Date().toISOString()
        })))
      if (baselineError) throw baselineError
    }

    if (card.card_appraisals.length) {
      const { error: appraisalError } = await supabaseClient
        .from('card_appraisals')
        .insert(card.card_appraisals.map((row) => ({
          user_id: currentSession.user.id,
          card_id: insertedCard.id,
          shop_name: row.shop_name,
          appraisal_price: row.appraisal_price,
          quantity: row.quantity,
          updated_at: new Date().toISOString()
        })))
      if (appraisalError) throw appraisalError
    }

    showMessage('カードを複製しました。', 'info')
    await loadAllData()
  } catch (error) {
    showMessage(error.message || 'カードの複製に失敗しました。', 'error')
  }
}

async function duplicateGroup(groupId) {
  const sourceGroup = loadedGroups.find((group) => group.id === groupId)
  if (!sourceGroup) return

  const groupCards = loadedCards.filter((card) => card.group_id === groupId)
  if (!groupCards.length) {
    showMessage('複製するカードがありません。', 'error')
    return
  }

  const usedNames = new Set(loadedGroups.map((group) => group.group_name))
  const duplicatedGroupName = nextCopyName(sourceGroup.group_name, usedNames)

  try {
    const { data: newGroup, error: insertGroupError } = await supabaseClient
      .from('appraisal_groups')
      .insert({
        user_id: currentSession.user.id,
        group_name: duplicatedGroupName,
        updated_at: new Date().toISOString()
      })
      .select('id, group_name, created_at, updated_at')
      .single()

    if (insertGroupError) throw insertGroupError

    for (const card of groupCards) {
      await duplicateCard(card.id, newGroup.id)
    }

    showMessage('カードグループを複製しました。', 'info')
    await loadAllData()
  } catch (error) {
    showMessage(error.message || 'カードグループの複製に失敗しました。', 'error')
  }
}

async function renameGroup(groupId) {
  const group = loadedGroups.find((item) => item.id === groupId)
  if (!group) return

  const nextName = window.prompt('新しいカードグループ名を入力してください。', group.group_name)
  if (nextName === null) return

  const trimmed = nextName.trim()
  if (!trimmed || trimmed === group.group_name) return

  try {
    const { error } = await supabaseClient
      .from('appraisal_groups')
      .update({
        group_name: trimmed,
        updated_at: new Date().toISOString()
      })
      .eq('id', groupId)

    if (error) throw error

    if (groupNameInput.value.trim() === group.group_name) {
      groupNameInput.value = trimmed
    }

    showMessage('カードグループ名を更新しました。', 'info')
    await loadAllData()
  } catch (error) {
    showMessage(error.message || 'カードグループ名の更新に失敗しました。', 'error')
  }
}

loginForm.addEventListener('submit', loginWithMagicLink)
signOutBtn.addEventListener('click', signOut)
cardForm.addEventListener('submit', saveCard)
addBaselineBtn.addEventListener('click', () => createBaselineRow())
addAppraisalBtn.addEventListener('click', () => createAppraisalRow())
reloadBtn.addEventListener('click', loadAllData)
cancelEditBtn.addEventListener('click', resetFormToCreateMode)

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  toggleUiBySession()
})

createBaselineRow()
createAppraisalRow()
updatePreview()
refreshSession()
