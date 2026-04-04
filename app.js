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

function getDiffClass(value) {
  const n = Number(value || 0)
  if (n > 0) return 'diff-positive'
  if (n < 0) return 'diff-negative'
  return ''
}

function calcTotal(price, quantity) {
  return Number(price || 0) * Number(quantity || 0)
}

function baselineLabel(index) {
  return index === 0 ? '基準とする最大価格' : `基準とする最大価格 ${index + 1}`
}

function currentIso() {
  return new Date().toISOString()
}

function sortByOrderThenCreated(items) {
  return [...(items || [])].sort((a, b) => {
    const orderDiff = Number(a.label_order || 0) - Number(b.label_order || 0)
    if (orderDiff !== 0) return orderDiff
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  })
}

function computeMetrics(baselines, appraisals) {
  const baselineEntries = (baselines || []).map((row) => ({
    ...row,
    total: calcTotal(row.referencePrice ?? row.reference_price, row.quantity)
  }))
  const appraisalEntries = (appraisals || []).map((row) => ({
    ...row,
    total: calcTotal(row.appraisalPrice ?? row.appraisal_price, row.quantity)
  }))

  const bestBaseline = baselineEntries.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)
  const bestAppraisal = appraisalEntries.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)
  const baselineMaxTotal = bestBaseline?.total ?? 0
  const maxAppraisalTotal = bestAppraisal?.total ?? 0
  const gap = baselineMaxTotal - maxAppraisalTotal

  return {
    baselineMaxTotal,
    maxAppraisalTotal,
    gap,
    bestBaseline,
    bestAppraisal,
    baselineEntries,
    appraisalEntries
  }
}

function updateGroupSuggestions() {
  groupSuggestions.innerHTML = loadedGroups
    .map((group) => `<option value="${escapeHtml(group.group_name)}"></option>`)
    .join('')
}

function renumberBaselineRows() {
  ;[...baselinesContainer.querySelectorAll('.baseline-row')].forEach((row, index) => {
    row.dataset.order = String(index + 1)
    const titleEl = row.querySelector('.entry-title strong')
    if (titleEl) titleEl.textContent = baselineLabel(index)
  })
}

function collectBaselineRows() {
  return [...baselinesContainer.querySelectorAll('.baseline-row')]
    .map((row, index) => {
      const shopName = row.querySelector('.baseline-shop-name').value.trim()
      const referencePrice = Number(row.querySelector('.baseline-reference-price').value || 0)
      const quantity = Number(row.querySelector('.baseline-quantity').value || 1)
      return {
        labelOrder: index + 1,
        shopName,
        referencePrice,
        quantity
      }
    })
    .filter((row) => row.shopName && Number.isFinite(row.referencePrice) && row.referencePrice >= 0 && Number.isFinite(row.quantity) && row.quantity >= 1)
}

function collectAppraisalRows() {
  return [...appraisalsContainer.querySelectorAll('.appraisal-row')]
    .map((row) => {
      const shopName = row.querySelector('.appraisal-shop-name').value.trim()
      const appraisalPrice = Number(row.querySelector('.appraisal-price').value || 0)
      const quantity = Number(row.querySelector('.appraisal-quantity').value || 1)
      return {
        shopName,
        appraisalPrice,
        quantity
      }
    })
    .filter((row) => row.shopName && Number.isFinite(row.appraisalPrice) && row.appraisalPrice >= 0 && Number.isFinite(row.quantity) && row.quantity >= 1)
}

function updatePreview() {
  const baselines = collectBaselineRows()
  const appraisals = collectAppraisalRows()
  const metrics = computeMetrics(baselines, appraisals)

  baselinePreview.textContent = formatYen(metrics.baselineMaxTotal)
  maxAppraisalPreview.textContent = formatYen(metrics.maxAppraisalTotal)
  gapPreview.textContent = formatYen(metrics.gap)
  gapPreview.className = getDiffClass(metrics.gap)

  ;[...baselinesContainer.querySelectorAll('.baseline-row')].forEach((row) => {
    const price = Number(row.querySelector('.baseline-reference-price').value || 0)
    const quantity = Number(row.querySelector('.baseline-quantity').value || 1)
    row.querySelector('.row-total-value').textContent = formatYen(calcTotal(price, quantity))
  })

  ;[...appraisalsContainer.querySelectorAll('.appraisal-row')].forEach((row) => {
    const price = Number(row.querySelector('.appraisal-price').value || 0)
    const quantity = Number(row.querySelector('.appraisal-quantity').value || 1)
    const total = calcTotal(price, quantity)
    const diff = metrics.baselineMaxTotal - total
    const totalEl = row.querySelector('.row-total-value')
    const diffEl = row.querySelector('.row-diff-value')
    totalEl.textContent = formatYen(total)
    diffEl.textContent = formatYen(diff)
    diffEl.className = `row-diff-value ${getDiffClass(diff)}`.trim()
  })
}

function createBaselineRow(values = {}) {
  const row = document.createElement('div')
  row.className = 'entry-row baseline-row'
  row.innerHTML = `
    <div class="entry-title">
      <strong>${baselineLabel(baselinesContainer.children.length)}</strong>
      <button type="button" class="danger small remove-entry">削除</button>
    </div>
    <div class="entry-grid">
      <label>
        参考店舗名
        <input type="text" class="baseline-shop-name" placeholder="例: A店" value="${escapeHtml(values.shop_name ?? values.shopName ?? '')}" />
      </label>
      <label>
        価格（1枚あたり円）
        <input type="number" min="0" step="1" class="baseline-reference-price" placeholder="例: 7800" value="${values.reference_price ?? values.referencePrice ?? ''}" />
      </label>
      <label>
        数量
        <input type="number" min="1" step="1" class="baseline-quantity" placeholder="1" value="${values.quantity ?? 1}" />
      </label>
      <div class="total-box">
        <span class="meta">総額</span>
        <strong class="row-total-value">0円</strong>
      </div>
      <div></div>
    </div>
  `

  row.querySelector('.remove-entry').addEventListener('click', () => {
    row.remove()
    if (baselinesContainer.children.length === 0) createBaselineRow()
    renumberBaselineRows()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updatePreview)
  })

  baselinesContainer.appendChild(row)
  renumberBaselineRows()
  updatePreview()
}

function createAppraisalRow(values = {}) {
  const row = document.createElement('div')
  row.className = 'entry-row appraisal-row'
  row.innerHTML = `
    <div class="entry-title">
      <strong>査定価格</strong>
      <button type="button" class="danger small remove-entry">削除</button>
    </div>
    <div class="entry-grid">
      <label>
        査定店舗名
        <input type="text" class="appraisal-shop-name" placeholder="例: B店" value="${escapeHtml(values.shop_name ?? values.shopName ?? '')}" />
      </label>
      <label>
        査定価格（1枚あたり円）
        <input type="number" min="0" step="1" class="appraisal-price" placeholder="例: 5200" value="${values.appraisal_price ?? values.appraisalPrice ?? ''}" />
      </label>
      <label>
        数量
        <input type="number" min="1" step="1" class="appraisal-quantity" placeholder="1" value="${values.quantity ?? 1}" />
      </label>
      <div class="total-box">
        <span class="meta">総額</span>
        <strong class="row-total-value">0円</strong>
      </div>
      <div class="diff-box">
        <span class="meta">基準との差額</span>
        <strong class="row-diff-value">0円</strong>
      </div>
    </div>
  `

  row.querySelector('.remove-entry').addEventListener('click', () => {
    row.remove()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updatePreview)
  })

  appraisalsContainer.appendChild(row)
  updatePreview()
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
  hideMessage()
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

  const baselines = sortByOrderThenCreated(card.card_baselines)
  const appraisals = [...(card.card_appraisals || [])]

  if (baselines.length) {
    baselines.forEach((row) => createBaselineRow(row))
  } else {
    createBaselineRow()
  }

  if (appraisals.length) {
    appraisals.forEach((row) => createAppraisalRow(row))
  } else {
    createAppraisalRow()
  }

  saveBtn.textContent = '変更を保存'
  editModeText.textContent = `「${card.card_name}」を編集中です。画像を変えない場合はそのまま保存できます。`
  editModeBar.classList.remove('hidden')
  window.scrollTo({ top: 0, behavior: 'smooth' })
  updatePreview()
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
    loadEverything()
  } else {
    groupsList.innerHTML = ''
    loadedGroups = []
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

  showMessage('ログイン用メールを送信しました。メール内のリンクをこのURLへ戻る形で開いてください。', 'info')
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
  const { error } = await supabaseClient.storage.from(BUCKET).upload(filePath, file, {
    cacheControl: '3600',
    upsert: false
  })
  if (error) throw error
  return filePath
}

async function getOrCreateGroup(groupName) {
  const cleanName = groupName.trim()
  const existing = loadedGroups.find((group) => group.group_name === cleanName)
  if (existing) return existing

  const { data, error } = await supabaseClient
    .from('appraisal_groups')
    .insert({
      user_id: currentSession.user.id,
      group_name: cleanName,
      updated_at: currentIso()
    })
    .select('id, group_name, created_at, updated_at')
    .single()

  if (error) throw error
  loadedGroups = [...loadedGroups, data]
  updateGroupSuggestions()
  return data
}

async function touchGroup(groupId) {
  if (!groupId) return
  await supabaseClient
    .from('appraisal_groups')
    .update({ updated_at: currentIso() })
    .eq('id', groupId)
}

async function tryRemoveImageIfUnused(imagePath, excludeCardId = null) {
  if (!imagePath) return

  let query = supabaseClient
    .from('cards')
    .select('id')
    .eq('image_path', imagePath)

  if (excludeCardId) {
    query = query.neq('id', excludeCardId)
  }

  const { data, error } = await query.limit(1)
  if (error) {
    console.warn(error)
    return
  }

  if (!data || data.length === 0) {
    const { error: removeError } = await supabaseClient.storage.from(BUCKET).remove([imagePath])
    if (removeError) console.warn(removeError)
  }
}

async function saveCard(event) {
  event.preventDefault()
  hideMessage()

  if (!currentSession?.user) {
    showMessage('先にログインしてください。', 'error')
    return
  }

  const file = imageInput.files?.[0]
  const groupName = groupNameInput.value.trim()
  const cardName = cardNameInput.value.trim()
  const baselines = collectBaselineRows()
  const appraisals = collectAppraisalRows()
  const metrics = computeMetrics(baselines, appraisals)

  if (!groupName) {
    showMessage('査定グループ名を入力してください。', 'error')
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
    showMessage('基準とする最大価格を 1 件以上入力してください。', 'error')
    return
  }

  saveBtn.disabled = true

  try {
    const group = await getOrCreateGroup(groupName)
    let imagePath = editingImagePath

    if (file) {
      imagePath = await uploadImage(file, currentSession.user.id)
    }

    const bestBaseline = metrics.bestBaseline || baselines[0]
    const payload = {
      user_id: currentSession.user.id,
      group_id: group.id,
      card_name: cardName,
      image_path: imagePath,
      appraisal_price: metrics.maxAppraisalTotal,
      baseline_shop_name: bestBaseline?.shopName ?? bestBaseline?.shop_name ?? null,
      baseline_highest_price: metrics.baselineMaxTotal,
      updated_at: currentIso()
    }

    let cardId = editingCardId

    if (editingCardId) {
      const { error: cardUpdateError } = await supabaseClient
        .from('cards')
        .update(payload)
        .eq('id', editingCardId)

      if (cardUpdateError) throw cardUpdateError

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

      if (file && editingImagePath && editingImagePath !== imagePath) {
        await tryRemoveImageIfUnused(editingImagePath, editingCardId)
      }
    } else {
      const { data: insertedCard, error: cardInsertError } = await supabaseClient
        .from('cards')
        .insert(payload)
        .select('id')
        .single()

      if (cardInsertError) throw cardInsertError
      cardId = insertedCard.id
    }

    const baselineRows = baselines.map((row) => ({
      user_id: currentSession.user.id,
      card_id: cardId,
      label_order: row.labelOrder,
      shop_name: row.shopName,
      reference_price: row.referencePrice,
      quantity: row.quantity,
      updated_at: currentIso()
    }))

    const appraisalRows = appraisals.map((row) => ({
      user_id: currentSession.user.id,
      card_id: cardId,
      shop_name: row.shopName,
      appraisal_price: row.appraisalPrice,
      quantity: row.quantity,
      updated_at: currentIso()
    }))

    if (baselineRows.length) {
      const { error: baselineInsertError } = await supabaseClient
        .from('card_baselines')
        .insert(baselineRows)
      if (baselineInsertError) throw baselineInsertError
    }

    if (appraisalRows.length) {
      const { error: appraisalInsertError } = await supabaseClient
        .from('card_appraisals')
        .insert(appraisalRows)
      if (appraisalInsertError) throw appraisalInsertError
    }

    await touchGroup(group.id)
    showMessage(editingCardId ? 'カード情報を更新しました。' : '保存しました。', 'info')
    resetFormToCreateMode()
    await loadEverything()
  } catch (error) {
    showMessage(error.message || '保存に失敗しました。', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

function renderBaselineList(card) {
  const baselines = sortByOrderThenCreated(card.card_baselines)
  if (!baselines.length) {
    return '<div class="empty">基準価格の登録がありません。</div>'
  }

  return `
    <div class="mini-list">
      ${baselines.map((row, index) => {
        const total = calcTotal(row.reference_price, row.quantity)
        return `
          <div class="mini-item baseline-mini">
            <div class="mini-title-row">
              <strong>${escapeHtml(baselineLabel(index))}</strong>
              <span class="badge">×${Number(row.quantity || 1)}</span>
            </div>
            <div class="meta">${escapeHtml(row.shop_name)}</div>
            <div class="mini-grid">
              <div>
                <div class="meta">単価</div>
                <strong>${formatYen(row.reference_price)}</strong>
              </div>
              <div>
                <div class="meta">数量</div>
                <strong>${Number(row.quantity || 1)}枚</strong>
              </div>
              <div>
                <div class="meta">総額</div>
                <strong>${formatYen(total)}</strong>
              </div>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
}

function renderAppraisalList(card, baselineMaxTotal) {
  const appraisals = [...(card.card_appraisals || [])]
  if (!appraisals.length) {
    return '<div class="empty">まだ査定価格の登録がありません。</div>'
  }

  return `
    <div class="mini-list">
      ${appraisals.map((row) => {
        const total = calcTotal(row.appraisal_price, row.quantity)
        const diff = baselineMaxTotal - total
        return `
          <div class="mini-item">
            <div class="mini-title-row">
              <strong>${escapeHtml(row.shop_name)}</strong>
              <span class="badge">×${Number(row.quantity || 1)}</span>
            </div>
            <div class="mini-grid">
              <div>
                <div class="meta">単価</div>
                <strong>${formatYen(row.appraisal_price)}</strong>
              </div>
              <div>
                <div class="meta">総額</div>
                <strong>${formatYen(total)}</strong>
              </div>
              <div>
                <div class="meta">基準との差額</div>
                <strong class="${getDiffClass(diff)}">${formatYen(diff)}</strong>
              </div>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
}

function buildCardHtml(card) {
  const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
  const publicUrl = card.image_path
    ? supabaseClient.storage.from(BUCKET).getPublicUrl(card.image_path).data.publicUrl
    : ''

  return `
    <article class="card-item">
      <div class="card-item-top">
        <img class="card-image" src="${escapeHtml(publicUrl)}" alt="${escapeHtml(card.card_name)}" />
        <div class="card-head">
          <div class="card-title-row">
            <div>
              <div class="meta">カードグループ：${escapeHtml(card.group_name || '未分類')}</div>
              <h3>${escapeHtml(card.card_name)}</h3>
            </div>
            <div class="card-actions">
              <button type="button" class="secondary small js-edit-card" data-card-id="${card.id}">編集</button>
              <button type="button" class="secondary small js-duplicate-card" data-card-id="${card.id}">複製</button>
              <button type="button" class="danger small js-delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
            </div>
          </div>
          <div class="meta">登録日: ${new Date(card.created_at).toLocaleString('ja-JP')}</div>
          <div class="card-summary">
            <div class="price-box">
              <div class="meta">基準とする最大価格</div>
              <strong>${formatYen(metrics.baselineMaxTotal)}</strong>
            </div>
            <div class="price-box">
              <div class="meta">最高査定価格</div>
              <strong>${formatYen(metrics.maxAppraisalTotal)}</strong>
            </div>
            <div class="price-box">
              <div class="meta">最大差額</div>
              <strong class="${getDiffClass(metrics.gap)}">${formatYen(metrics.gap)}</strong>
            </div>
          </div>
        </div>
      </div>

      <section class="card-section">
        <h4>基準とする最大価格の候補</h4>
        ${renderBaselineList(card)}
      </section>

      <section class="card-section">
        <h4>店舗ごとの査定価格</h4>
        ${renderAppraisalList(card, metrics.baselineMaxTotal)}
      </section>
    </article>
  `
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
    const key = card.group_id || 'ungrouped'
    if (!groupsById.has(key)) {
      groupsById.set(key, {
        id: key,
        group_name: card.group_name || '未分類',
        cards: []
      })
    }
    groupsById.get(key).cards.push(card)
  })

  const groupBlocks = [...groupsById.values()]
    .filter((group) => group.cards?.length)
    .sort((a, b) => (a.group_name || '').localeCompare(b.group_name || '', 'ja'))
    .map((group) => {
      const cards = [...group.cards].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      const totals = cards.reduce((acc, card) => {
        const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
        acc.baseline += metrics.baselineMaxTotal
        acc.appraisal += metrics.maxAppraisalTotal
        acc.gap += metrics.gap
        return acc
      }, { baseline: 0, appraisal: 0, gap: 0 })

      return `
        <section class="group-block">
          <div class="group-head">
            <div class="group-title-wrap">
              <div class="group-label">カードグループ：${escapeHtml(group.group_name)}</div>
              <div class="group-summary">
                <div class="price-box">
                  <div class="meta">基準とする最大価格 合計</div>
                  <strong>${formatYen(totals.baseline)}</strong>
                </div>
                <div class="price-box">
                  <div class="meta">最高査定価格 合計</div>
                  <strong>${formatYen(totals.appraisal)}</strong>
                </div>
                <div class="price-box">
                  <div class="meta">最大差額 合計</div>
                  <strong class="${getDiffClass(totals.gap)}">${formatYen(totals.gap)}</strong>
                </div>
              </div>
            </div>
            <div class="group-actions">
              <button type="button" class="secondary small js-duplicate-group" data-group-id="${group.id}">グループを複製</button>
            </div>
          </div>
          <div class="cards-grid">
            ${cards.map(buildCardHtml).join('')}
          </div>
        </section>
      `
    })

  groupsList.innerHTML = groupBlocks.join('')
}

async function loadEverything() {
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
        baseline_shop_name,
        baseline_highest_price,
        appraisal_price,
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
  const groupNameMap = new Map(loadedGroups.map((group) => [group.id, group.group_name]))
  loadedCards = (cardsResult.data || []).map((card) => ({
    ...card,
    group_name: groupNameMap.get(card.group_id) || '未分類',
    card_baselines: sortByOrderThenCreated(card.card_baselines),
    card_appraisals: [...(card.card_appraisals || [])]
  }))

  updateGroupSuggestions()
  renderGroups()
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm('このカードデータを削除しますか？')
  if (!ok) return

  try {
    const { error } = await supabaseClient.from('cards').delete().eq('id', cardId)
    if (error) throw error
    await tryRemoveImageIfUnused(imagePath, cardId)
    showMessage('削除しました。', 'info')
    await loadEverything()
  } catch (error) {
    showMessage(error.message || '削除に失敗しました。', 'error')
  }
}

function buildUniqueCopyName(baseName, existingNames) {
  let candidate = `${baseName} のコピー`
  let n = 2
  while (existingNames.has(candidate)) {
    candidate = `${baseName} のコピー ${n}`
    n += 1
  }
  return candidate
}

async function duplicateCard(cardId) {
  const card = loadedCards.find((item) => item.id === cardId)
  if (!card || !currentSession?.user) return

  try {
    const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
    const { data: newCard, error: cardError } = await supabaseClient
      .from('cards')
      .insert({
        user_id: currentSession.user.id,
        group_id: card.group_id,
        card_name: `${card.card_name}（コピー）`,
        image_path: card.image_path,
        appraisal_price: metrics.maxAppraisalTotal,
        baseline_shop_name: metrics.bestBaseline?.shop_name || metrics.bestBaseline?.shopName || null,
        baseline_highest_price: metrics.baselineMaxTotal,
        updated_at: currentIso()
      })
      .select('id')
      .single()

    if (cardError) throw cardError

    const baselines = sortByOrderThenCreated(card.card_baselines).map((row, index) => ({
      user_id: currentSession.user.id,
      card_id: newCard.id,
      label_order: index + 1,
      shop_name: row.shop_name,
      reference_price: row.reference_price,
      quantity: row.quantity,
      updated_at: currentIso()
    }))

    const appraisals = (card.card_appraisals || []).map((row) => ({
      user_id: currentSession.user.id,
      card_id: newCard.id,
      shop_name: row.shop_name,
      appraisal_price: row.appraisal_price,
      quantity: row.quantity,
      updated_at: currentIso()
    }))

    if (baselines.length) {
      const { error: baselineError } = await supabaseClient.from('card_baselines').insert(baselines)
      if (baselineError) throw baselineError
    }

    if (appraisals.length) {
      const { error: appraisalError } = await supabaseClient.from('card_appraisals').insert(appraisals)
      if (appraisalError) throw appraisalError
    }

    await touchGroup(card.group_id)
    showMessage('カードを複製しました。', 'info')
    await loadEverything()
  } catch (error) {
    showMessage(error.message || 'カードの複製に失敗しました。', 'error')
  }
}

async function duplicateGroup(groupId) {
  const targetGroup = loadedGroups.find((group) => group.id === groupId)
  if (!targetGroup || !currentSession?.user) return

  const targetCards = loadedCards.filter((card) => card.group_id === groupId)
  if (!targetCards.length) {
    showMessage('複製対象のカードがありません。', 'error')
    return
  }

  try {
    const existingNames = new Set(loadedGroups.map((group) => group.group_name))
    const newGroupName = buildUniqueCopyName(targetGroup.group_name, existingNames)

    const { data: newGroup, error: groupError } = await supabaseClient
      .from('appraisal_groups')
      .insert({
        user_id: currentSession.user.id,
        group_name: newGroupName,
        updated_at: currentIso()
      })
      .select('id, group_name, created_at, updated_at')
      .single()

    if (groupError) throw groupError

    for (const card of targetCards) {
      const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
      const { data: insertedCard, error: cardInsertError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          group_id: newGroup.id,
          card_name: card.card_name,
          image_path: card.image_path,
          appraisal_price: metrics.maxAppraisalTotal,
          baseline_shop_name: metrics.bestBaseline?.shop_name || metrics.bestBaseline?.shopName || null,
          baseline_highest_price: metrics.baselineMaxTotal,
          updated_at: currentIso()
        })
        .select('id')
        .single()

      if (cardInsertError) throw cardInsertError

      const baselines = sortByOrderThenCreated(card.card_baselines).map((row, index) => ({
        user_id: currentSession.user.id,
        card_id: insertedCard.id,
        label_order: index + 1,
        shop_name: row.shop_name,
        reference_price: row.reference_price,
        quantity: row.quantity,
        updated_at: currentIso()
      }))

      const appraisals = (card.card_appraisals || []).map((row) => ({
        user_id: currentSession.user.id,
        card_id: insertedCard.id,
        shop_name: row.shop_name,
        appraisal_price: row.appraisal_price,
        quantity: row.quantity,
        updated_at: currentIso()
      }))

      if (baselines.length) {
        const { error: baselineError } = await supabaseClient.from('card_baselines').insert(baselines)
        if (baselineError) throw baselineError
      }

      if (appraisals.length) {
        const { error: appraisalError } = await supabaseClient.from('card_appraisals').insert(appraisals)
        if (appraisalError) throw appraisalError
      }
    }

    showMessage(`グループ「${newGroupName}」を作成して複製しました。`, 'info')
    await loadEverything()
  } catch (error) {
    showMessage(error.message || 'グループの複製に失敗しました。', 'error')
  }
}

loginForm.addEventListener('submit', loginWithMagicLink)
signOutBtn.addEventListener('click', signOut)
cardForm.addEventListener('submit', saveCard)
addBaselineBtn.addEventListener('click', () => createBaselineRow())
addAppraisalBtn.addEventListener('click', () => createAppraisalRow())
reloadBtn.addEventListener('click', loadEverything)
cancelEditBtn.addEventListener('click', resetFormToCreateMode)

groupsList.addEventListener('click', async (event) => {
  const target = event.target.closest('button')
  if (!target) return

  if (target.classList.contains('js-edit-card')) {
    startEditMode(target.dataset.cardId)
    return
  }

  if (target.classList.contains('js-delete-card')) {
    await deleteCard(target.dataset.cardId, target.dataset.imagePath)
    return
  }

  if (target.classList.contains('js-duplicate-card')) {
    await duplicateCard(target.dataset.cardId)
    return
  }

  if (target.classList.contains('js-duplicate-group')) {
    await duplicateGroup(target.dataset.groupId)
  }
})

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  toggleUiBySession()
})

createBaselineRow()
createAppraisalRow()
refreshSession()
