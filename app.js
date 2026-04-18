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
const TAB_PALETTE = ['#9dd9d2', '#9bd0ff', '#f8a4be', '#a7cf4d', '#c4b5fd', '#fdba74', '#86efac', '#fca5a5']

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
const groupTabs = document.getElementById('groupTabs')
const activeGroupArea = document.getElementById('activeGroupArea')
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
let activeGroupId = null
let cardsSortable = null

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

function currentIso() {
  return new Date().toISOString()
}

function getDiffClass(value) {
  const n = Number(value || 0)
  if (n > 0) return 'diff-positive'
  if (n < 0) return 'diff-negative'
  return ''
}

function baselineLabel(index) {
  if (index === 0) return '基準とする最大価格'
  if (index === 1) return '参考にする価格'
  return `参考にする価格${index}`
}

function sortedByLabelOrder(items = []) {
  return [...items].sort((a, b) => {
    const diff = Number(a.label_order || 0) - Number(b.label_order || 0)
    if (diff !== 0) return diff
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  })
}

function computeMetrics(baselines = [], appraisals = []) {
  const baselineEntries = sortedByLabelOrder(baselines).map((row) => ({
    ...row,
    total: calcTotal(row.reference_price ?? row.referencePrice, row.quantity)
  }))
  const appraisalEntries = [...appraisals].map((row) => ({
    ...row,
    total: calcTotal(row.appraisal_price ?? row.appraisalPrice, row.quantity)
  }))

  const bestBaseline = baselineEntries.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)
  const bestAppraisal = appraisalEntries.reduce((best, row) => row.total > (best?.total ?? -1) ? row : best, null)
  const baselineMaxTotal = bestBaseline?.total ?? 0
  const maxAppraisalTotal = bestAppraisal?.total ?? 0
  const gap = baselineMaxTotal - maxAppraisalTotal
  const quantityCandidates = [
    ...baselineEntries.map((row) => Number(row.quantity || 0)),
    ...appraisalEntries.map((row) => Number(row.quantity || 0)),
    1
  ]
  const cardCopies = Math.max(...quantityCandidates)

  return {
    baselineEntries,
    appraisalEntries,
    bestBaseline,
    bestAppraisal,
    baselineMaxTotal,
    maxAppraisalTotal,
    gap,
    cardCopies
  }
}

function updateGroupSuggestions() {
  groupSuggestions.innerHTML = loadedGroups
    .map((group) => `<option value="${escapeHtml(group.group_name)}"></option>`)
    .join('')
}

function toggleUiBySession() {
  const signedIn = !!currentSession?.user
  authSection.classList.toggle('hidden', signedIn)
  appSection.classList.toggle('hidden', !signedIn)
  userArea.classList.toggle('hidden', !signedIn)
  userEmail.textContent = currentSession?.user?.email || ''
}

async function refreshSession() {
  const { data, error } = await supabaseClient.auth.getSession()
  if (error) {
    showMessage(error.message, 'error')
    return
  }
  currentSession = data.session
  toggleUiBySession()
  if (currentSession?.user) {
    await loadAllData()
  }
}

function renumberBaselineRows() {
  ;[...baselinesContainer.querySelectorAll('.baseline-row')].forEach((row, index) => {
    row.dataset.order = String(index + 1)
    const titleEl = row.querySelector('.entry-title strong')
    if (titleEl) titleEl.textContent = baselineLabel(index)
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
      <div class="inline-total-box">
        <span class="meta">総額</span>
        <strong class="row-total-value">0円</strong>
      </div>
      <div></div>
    </div>
  `

  row.querySelector('.remove-entry').addEventListener('click', () => {
    row.remove()
    if (!baselinesContainer.children.length) createBaselineRow()
    renumberBaselineRows()
    updatePreview()
  })

  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updatePreview))
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
      <div class="inline-total-box">
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

  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updatePreview))
  appraisalsContainer.appendChild(row)
  updatePreview()
}

function collectBaselineRows() {
  return [...baselinesContainer.querySelectorAll('.baseline-row')]
    .map((row, index) => ({
      labelOrder: index + 1,
      shopName: row.querySelector('.baseline-shop-name').value.trim(),
      referencePrice: Number(row.querySelector('.baseline-reference-price').value || 0),
      quantity: Number(row.querySelector('.baseline-quantity').value || 1)
    }))
    .filter((row) => row.shopName && Number.isFinite(row.referencePrice) && row.referencePrice >= 0 && Number.isFinite(row.quantity) && row.quantity >= 1)
}

function collectAppraisalRows() {
  return [...appraisalsContainer.querySelectorAll('.appraisal-row')]
    .map((row) => ({
      shopName: row.querySelector('.appraisal-shop-name').value.trim(),
      appraisalPrice: Number(row.querySelector('.appraisal-price').value || 0),
      quantity: Number(row.querySelector('.appraisal-quantity').value || 1)
    }))
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

function resetForm(keepGroupName = true) {
  const groupName = keepGroupName ? groupNameInput.value.trim() : ''
  cardForm.reset()
  groupNameInput.value = groupName
  baselinesContainer.innerHTML = ''
  appraisalsContainer.innerHTML = ''
  createBaselineRow()
  editingCardId = null
  editingImagePath = null
  editModeBar.classList.add('hidden')
  saveBtn.textContent = 'カードを登録'
  updatePreview()
}

function setEditMode(card) {
  editingCardId = card.id
  editingImagePath = card.image_path
  editModeBar.classList.remove('hidden')
  saveBtn.textContent = '変更を保存'
  editModeText.textContent = `${card.card_name} を編集中です。`

  const group = loadedGroups.find((row) => row.id === card.group_id)
  groupNameInput.value = group?.group_name || ''
  cardNameInput.value = card.card_name || ''
  imageInput.value = ''

  baselinesContainer.innerHTML = ''
  appraisalsContainer.innerHTML = ''

  const baselines = sortedByLabelOrder(card.card_baselines || [])
  if (baselines.length) {
    baselines.forEach((row) => createBaselineRow(row))
  } else {
    createBaselineRow()
  }

  const appraisals = card.card_appraisals || []
  if (appraisals.length) {
    appraisals.forEach((row) => createAppraisalRow(row))
  }

  updatePreview()
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
    .upload(filePath, file, { cacheControl: '3600', upsert: false })

  if (error) throw error
  return filePath
}

function getNextSortOrder(groupId) {
  const numbers = loadedCards
    .filter((card) => card.group_id === groupId)
    .map((card) => Number(card.sort_order || 0))
  return numbers.length ? Math.max(...numbers) + 1 : 1
}

async function findOrCreateGroupByName(groupName) {
  const normalized = groupName.trim()
  const existing = loadedGroups.find((group) => group.group_name === normalized)
  if (existing) return existing

  const { data, error } = await supabaseClient
    .from('card_groups')
    .insert({ user_id: currentSession.user.id, group_name: normalized })
    .select('id, group_name, created_at, updated_at')
    .single()

  if (error) throw error
  return data
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
  const baselines = collectBaselineRows()
  const appraisals = collectAppraisalRows()
  const file = imageInput.files?.[0]

  if (!groupName) {
    showMessage('査定グループ名を入力してください。', 'error')
    return
  }
  if (!cardName) {
    showMessage('カード名を入力してください。', 'error')
    return
  }
  if (!editingCardId && !file) {
    showMessage('カード画像を選択してください。', 'error')
    return
  }
  if (file && file.size > MAX_IMAGE_BYTES) {
    showMessage('画像サイズは 6MB 以下にしてください。', 'error')
    return
  }
  if (!baselines.length) {
    showMessage('基準とする最大価格を1件以上入力してください。', 'error')
    return
  }

  saveBtn.disabled = true

  try {
    const group = await findOrCreateGroupByName(groupName)
    let imagePath = editingImagePath

    if (file) {
      imagePath = await uploadImage(file, currentSession.user.id)
    }

    if (editingCardId) {
      const { error: cardError } = await supabaseClient
        .from('cards')
        .update({
          group_id: group.id,
          card_name: cardName,
          image_path: imagePath,
          appraisal_price: 0,
          updated_at: currentIso()
        })
        .eq('id', editingCardId)

      if (cardError) throw cardError

      const { error: deleteBaselineError } = await supabaseClient
        .from('card_baselines')
        .delete()
        .eq('card_id', editingCardId)

      if (deleteBaselineError) throw deleteBaselineError

      const { error: deleteAppraisalError } = await supabaseClient
        .from('card_appraisals')
        .delete()
        .eq('card_id', editingCardId)

      if (deleteAppraisalError) throw deleteAppraisalError

      const baselineRows = baselines.map((row) => ({
        user_id: currentSession.user.id,
        card_id: editingCardId,
        shop_name: row.shopName,
        reference_price: row.referencePrice,
        quantity: row.quantity,
        label_order: row.labelOrder
      }))

      const { error: baselineError } = await supabaseClient.from('card_baselines').insert(baselineRows)
      if (baselineError) throw baselineError

      if (appraisals.length) {
        const appraisalRows = appraisals.map((row) => ({
          user_id: currentSession.user.id,
          card_id: editingCardId,
          shop_name: row.shopName,
          appraisal_price: row.appraisalPrice,
          quantity: row.quantity
        }))
        const { error: appraisalError } = await supabaseClient.from('card_appraisals').insert(appraisalRows)
        if (appraisalError) throw appraisalError
      }
    } else {
      const { data: cardRow, error: cardError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          group_id: group.id,
          card_name: cardName,
          image_path: imagePath,
          appraisal_price: 0,
          sort_order: getNextSortOrder(group.id),
          updated_at: currentIso()
        })
        .select('id')
        .single()

      if (cardError) throw cardError

      const baselineRows = baselines.map((row) => ({
        user_id: currentSession.user.id,
        card_id: cardRow.id,
        shop_name: row.shopName,
        reference_price: row.referencePrice,
        quantity: row.quantity,
        label_order: row.labelOrder
      }))

      const { error: baselineError } = await supabaseClient.from('card_baselines').insert(baselineRows)
      if (baselineError) throw baselineError

      if (appraisals.length) {
        const appraisalRows = appraisals.map((row) => ({
          user_id: currentSession.user.id,
          card_id: cardRow.id,
          shop_name: row.shopName,
          appraisal_price: row.appraisalPrice,
          quantity: row.quantity
        }))
        const { error: appraisalError } = await supabaseClient.from('card_appraisals').insert(appraisalRows)
        if (appraisalError) throw appraisalError
      }
    }

    showMessage('保存しました。', 'info')
    const keepGroupName = groupNameInput.value.trim()
    resetForm(true)
    groupNameInput.value = keepGroupName
    await loadAllData(group.id)
  } catch (error) {
    showMessage(error.message || '保存に失敗しました。', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

async function loadAllData(preferredGroupId = activeGroupId) {
  if (!currentSession?.user) return

  activeGroupArea.innerHTML = '<div class="empty">読み込み中...</div>'
  groupTabs.innerHTML = ''

  const [groupsResult, cardsResult] = await Promise.all([
    supabaseClient
      .from('card_groups')
      .select('id, group_name, created_at, updated_at')
      .order('created_at', { ascending: true }),
    supabaseClient
      .from('cards')
      .select(`
        id,
        user_id,
        group_id,
        card_name,
        appraisal_price,
        image_path,
        sort_order,
        created_at,
        updated_at,
        card_baselines (
          id,
          shop_name,
          reference_price,
          quantity,
          label_order,
          created_at
        ),
        card_appraisals (
          id,
          shop_name,
          appraisal_price,
          quantity,
          created_at
        )
      `)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  ])

  if (groupsResult.error) {
    showMessage(groupsResult.error.message, 'error')
    activeGroupArea.innerHTML = ''
    return
  }
  if (cardsResult.error) {
    showMessage(cardsResult.error.message, 'error')
    activeGroupArea.innerHTML = ''
    return
  }

  loadedGroups = groupsResult.data || []
  loadedCards = cardsResult.data || []
  updateGroupSuggestions()

  if (!loadedGroups.length) {
    groupTabs.innerHTML = ''
    activeGroupArea.innerHTML = '<div class="empty">まだカードグループがありません。上のフォームから最初のカードを登録してください。</div>'
    return
  }

  activeGroupId = preferredGroupId && loadedGroups.some((group) => group.id === preferredGroupId)
    ? preferredGroupId
    : activeGroupId && loadedGroups.some((group) => group.id === activeGroupId)
      ? activeGroupId
      : loadedGroups[0].id

  renderGroupTabs()
  renderActiveGroup()
}

function getCardsForGroup(groupId) {
  return loadedCards
    .filter((card) => card.group_id === groupId)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

function summarizeGroup(cards) {
  return cards.reduce((acc, card) => {
    const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
    acc.baselineTotal += metrics.baselineMaxTotal
    acc.appraisalTotal += metrics.maxAppraisalTotal
    acc.gapTotal += metrics.gap
    acc.types += 1
    acc.copies += metrics.cardCopies
    return acc
  }, { baselineTotal: 0, appraisalTotal: 0, gapTotal: 0, types: 0, copies: 0 })
}

function renderGroupTabs() {
  groupTabs.innerHTML = loadedGroups.map((group, index) => {
    const isActive = group.id === activeGroupId
    const bg = TAB_PALETTE[index % TAB_PALETTE.length]
    return `
      <button
        type="button"
        class="group-tab ${isActive ? 'is-active' : ''}"
        data-group-id="${group.id}"
        style="--tab-bg:${bg};"
        title="${escapeHtml(group.group_name)}"
      >${escapeHtml(group.group_name)}</button>
    `
  }).join('')

  groupTabs.querySelectorAll('.group-tab').forEach((button) => {
    button.addEventListener('click', () => {
      activeGroupId = button.dataset.groupId
      renderGroupTabs()
      renderActiveGroup()
    })
  })
}

function buildBaselineMiniHtml(row, index) {
  return `
    <div class="mini-item">
      <div class="mini-title">${escapeHtml(baselineLabel(index + 1))}</div>
      <div class="mini-line">${escapeHtml(row.shop_name)}</div>
      <div class="mini-line">単価 ${formatYen(row.reference_price)}</div>
      <div class="mini-line">数量 ×${Number(row.quantity || 1)}</div>
      <div class="mini-line">総額 ${formatYen(calcTotal(row.reference_price, row.quantity))}</div>
    </div>
  `
}

function buildCardHtml(card) {
  const metrics = computeMetrics(card.card_baselines || [], card.card_appraisals || [])
  const baselines = sortedByLabelOrder(card.card_baselines || [])
  const primaryBaseline = baselines[0]
  const otherBaselines = baselines.slice(1)
  const publicUrl = supabaseClient.storage.from(BUCKET).getPublicUrl(card.image_path).data.publicUrl

  const appraisalRows = metrics.appraisalEntries.map((row) => {
    const diff = metrics.baselineMaxTotal - row.total
    return `
      <tr>
        <td>${escapeHtml(row.shop_name)}</td>
        <td>${formatYen(row.appraisal_price)}</td>
        <td>×${Number(row.quantity || 1)}</td>
        <td>${formatYen(row.total)}</td>
        <td class="${getDiffClass(diff)}">${formatYen(diff)}</td>
      </tr>
    `
  }).join('') || '<tr><td colspan="5" class="meta">まだ査定価格がありません。</td></tr>'

  return `
    <article class="card-item" data-card-id="${card.id}">
      <div class="card-head">
        <div class="drag-handle" title="ドラッグして並べ替え">☰</div>
        <div class="card-head-text">
          <div class="card-name">${escapeHtml(card.card_name)}</div>
          <div class="meta">登録日: ${new Date(card.created_at).toLocaleString('ja-JP')}</div>
        </div>
      </div>

      <div class="card-body">
        <img class="card-image" src="${publicUrl}" alt="${escapeHtml(card.card_name)}" />

        <div class="card-actions">
          <button type="button" class="secondary small edit-card" data-card-id="${card.id}">編集</button>
          <button type="button" class="secondary small duplicate-card" data-card-id="${card.id}">複製</button>
          <button type="button" class="danger small delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
        </div>

        <div class="card-summary">
          <div class="price-box">
            <div class="meta">基準とする最大価格</div>
            <strong>${formatYen(metrics.baselineMaxTotal)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最高査定価格</div>
            <strong class="value-appraisal">${formatYen(metrics.maxAppraisalTotal)}</strong>
          </div>
          <div class="price-box">
            <div class="meta">最大差額</div>
            <strong>${formatYen(metrics.gap)}</strong>
          </div>
        </div>

        ${primaryBaseline ? `
          <div class="baseline-strip">
            <div class="baseline-primary">
              <div class="mini-title">基準とする最大価格</div>
              <div class="mini-line">${escapeHtml(primaryBaseline.shop_name)}</div>
              <div class="mini-line">単価 ${formatYen(primaryBaseline.reference_price)}</div>
              <div class="mini-line">数量 ×${Number(primaryBaseline.quantity || 1)}</div>
              <div class="mini-line">総額 ${formatYen(calcTotal(primaryBaseline.reference_price, primaryBaseline.quantity))}</div>
            </div>
            ${otherBaselines.length ? `<div class="baseline-mini-grid">${otherBaselines.map((row, index) => buildBaselineMiniHtml(row, index)).join('')}</div>` : ''}
          </div>
        ` : ''}

        <div class="table-wrap">
          <table class="data-table">
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
              ${appraisalRows}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  `
}

function renderActiveGroup() {
  const group = loadedGroups.find((row) => row.id === activeGroupId)
  if (!group) {
    activeGroupArea.innerHTML = '<div class="empty">表示できるグループがありません。</div>'
    return
  }

  const cards = getCardsForGroup(group.id)
  const summary = summarizeGroup(cards)

  activeGroupArea.innerHTML = `
    <section class="group-shell">
      <div class="group-shell-head">
        <div class="group-title-wrap">
          <span class="group-label">カードグループ：${escapeHtml(group.group_name)}</span>
          <p class="help">タブ名はここで変更すると、そのままタブ表示にも反映されます。</p>
        </div>
        <div class="group-action-row">
          <button type="button" class="secondary small rename-group" data-group-id="${group.id}">グループ名変更</button>
          <button type="button" class="secondary small duplicate-group" data-group-id="${group.id}">グループ複製</button>
        </div>
      </div>

      <div class="group-summary">
        <div class="group-count-box">
          <div class="meta">登録状況</div>
          <strong class="count-value">カード枚数: ${summary.types}種 - 合計${summary.copies}枚</strong>
        </div>
        <div class="price-box">
          <div class="meta">基準とする最大価格 合計</div>
          <strong>${formatYen(summary.baselineTotal)}</strong>
        </div>
        <div class="price-box">
          <div class="meta">最高査定価格 合計</div>
          <strong class="value-appraisal">${formatYen(summary.appraisalTotal)}</strong>
        </div>
        <div class="price-box">
          <div class="meta">最大差額 合計</div>
          <strong>${formatYen(summary.gapTotal)}</strong>
        </div>
      </div>

      ${cards.length ? `<div id="cardsGrid" class="cards-grid">${cards.map(buildCardHtml).join('')}</div>` : '<div class="empty">このグループにはまだカードがありません。</div>'}
    </section>
  `

  activeGroupArea.querySelector('.rename-group')?.addEventListener('click', () => renameGroup(group.id))
  activeGroupArea.querySelector('.duplicate-group')?.addEventListener('click', () => duplicateGroup(group.id))

  activeGroupArea.querySelectorAll('.edit-card').forEach((button) => {
    button.addEventListener('click', () => {
      const card = loadedCards.find((row) => row.id === button.dataset.cardId)
      if (card) setEditMode(card)
    })
  })

  activeGroupArea.querySelectorAll('.duplicate-card').forEach((button) => {
    button.addEventListener('click', () => duplicateCard(button.dataset.cardId))
  })

  activeGroupArea.querySelectorAll('.delete-card').forEach((button) => {
    button.addEventListener('click', () => deleteCard(button.dataset.cardId, button.dataset.imagePath))
  })

  initCardsSortable()
}

function initCardsSortable() {
  const cardsGrid = document.getElementById('cardsGrid')
  if (cardsSortable) {
    cardsSortable.destroy()
    cardsSortable = null
  }
  if (!cardsGrid || typeof Sortable === 'undefined') return

  cardsSortable = Sortable.create(cardsGrid, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'drag-ghost',
    chosenClass: 'dragging',
    onEnd: async () => {
      await persistCardOrder(cardsGrid)
    }
  })
}

async function persistCardOrder(cardsGrid) {
  const cardIds = [...cardsGrid.querySelectorAll('.card-item')].map((node) => node.dataset.cardId)
  try {
    await Promise.all(cardIds.map((cardId, index) => {
      return supabaseClient
        .from('cards')
        .update({ sort_order: index + 1, updated_at: currentIso() })
        .eq('id', cardId)
    }))

    loadedCards = loadedCards.map((card) => {
      const newIndex = cardIds.indexOf(card.id)
      return newIndex >= 0 && card.group_id === activeGroupId
        ? { ...card, sort_order: newIndex + 1 }
        : card
    })
    renderActiveGroup()
  } catch (error) {
    showMessage(error.message || '並べ替えの保存に失敗しました。', 'error')
  }
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm('このカードデータを削除しますか？')
  if (!ok) return

  try {
    const sameImageCards = loadedCards.filter((card) => card.image_path === imagePath && card.id !== cardId)

    const { error: cardError } = await supabaseClient
      .from('cards')
      .delete()
      .eq('id', cardId)

    if (cardError) throw cardError

    if (editingCardId === cardId) {
      resetForm(false)
    }

    if (!sameImageCards.length && imagePath) {
      const { error: fileError } = await supabaseClient.storage.from(BUCKET).remove([imagePath])
      if (fileError) console.warn(fileError)
    }

    showMessage('削除しました。', 'info')
    await loadAllData(activeGroupId)
  } catch (error) {
    showMessage(error.message || '削除に失敗しました。', 'error')
  }
}

async function duplicateCard(cardId) {
  const sourceCard = loadedCards.find((card) => card.id === cardId)
  if (!sourceCard) return

  try {
    const { data: newCard, error: insertError } = await supabaseClient
      .from('cards')
      .insert({
        user_id: currentSession.user.id,
        group_id: sourceCard.group_id,
        card_name: `${sourceCard.card_name}（複製）`,
        image_path: sourceCard.image_path,
        appraisal_price: 0,
        sort_order: getNextSortOrder(sourceCard.group_id),
        updated_at: currentIso()
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    const baselineRows = sortedByLabelOrder(sourceCard.card_baselines || []).map((row) => ({
      user_id: currentSession.user.id,
      card_id: newCard.id,
      shop_name: row.shop_name,
      reference_price: row.reference_price,
      quantity: row.quantity,
      label_order: row.label_order
    }))

    const appraisalRows = (sourceCard.card_appraisals || []).map((row) => ({
      user_id: currentSession.user.id,
      card_id: newCard.id,
      shop_name: row.shop_name,
      appraisal_price: row.appraisal_price,
      quantity: row.quantity
    }))

    if (baselineRows.length) {
      const { error } = await supabaseClient.from('card_baselines').insert(baselineRows)
      if (error) throw error
    }
    if (appraisalRows.length) {
      const { error } = await supabaseClient.from('card_appraisals').insert(appraisalRows)
      if (error) throw error
    }

    showMessage('カードを複製しました。', 'info')
    await loadAllData(sourceCard.group_id)
  } catch (error) {
    showMessage(error.message || 'カードの複製に失敗しました。', 'error')
  }
}

function uniqueGroupCopyName(baseName) {
  let name = `${baseName} コピー`
  let counter = 2
  while (loadedGroups.some((group) => group.group_name === name)) {
    name = `${baseName} コピー${counter}`
    counter += 1
  }
  return name
}

async function duplicateGroup(groupId) {
  const group = loadedGroups.find((row) => row.id === groupId)
  if (!group) return

  try {
    const newGroupName = uniqueGroupCopyName(group.group_name)
    const { data: newGroup, error: groupError } = await supabaseClient
      .from('card_groups')
      .insert({ user_id: currentSession.user.id, group_name: newGroupName })
      .select('id, group_name')
      .single()

    if (groupError) throw groupError

    const sourceCards = getCardsForGroup(groupId)
    let nextSortOrder = 1
    for (const sourceCard of sourceCards) {
      const { data: newCard, error: cardError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          group_id: newGroup.id,
          card_name: sourceCard.card_name,
          image_path: sourceCard.image_path,
          appraisal_price: 0,
          sort_order: nextSortOrder,
          updated_at: currentIso()
        })
        .select('id')
        .single()

      if (cardError) throw cardError

      const baselineRows = sortedByLabelOrder(sourceCard.card_baselines || []).map((row) => ({
        user_id: currentSession.user.id,
        card_id: newCard.id,
        shop_name: row.shop_name,
        reference_price: row.reference_price,
        quantity: row.quantity,
        label_order: row.label_order
      }))
      const appraisalRows = (sourceCard.card_appraisals || []).map((row) => ({
        user_id: currentSession.user.id,
        card_id: newCard.id,
        shop_name: row.shop_name,
        appraisal_price: row.appraisal_price,
        quantity: row.quantity
      }))

      if (baselineRows.length) {
        const { error } = await supabaseClient.from('card_baselines').insert(baselineRows)
        if (error) throw error
      }
      if (appraisalRows.length) {
        const { error } = await supabaseClient.from('card_appraisals').insert(appraisalRows)
        if (error) throw error
      }

      nextSortOrder += 1
    }

    showMessage('グループを複製しました。', 'info')
    await loadAllData(newGroup.id)
  } catch (error) {
    showMessage(error.message || 'グループの複製に失敗しました。', 'error')
  }
}

async function renameGroup(groupId) {
  const group = loadedGroups.find((row) => row.id === groupId)
  if (!group) return

  const newName = window.prompt('新しいグループ名を入力してください。', group.group_name)
  if (!newName) return
  const trimmed = newName.trim()
  if (!trimmed || trimmed === group.group_name) return

  try {
    const { error } = await supabaseClient
      .from('card_groups')
      .update({ group_name: trimmed, updated_at: currentIso() })
      .eq('id', groupId)

    if (error) throw error

    if (groupNameInput.value.trim() === group.group_name) {
      groupNameInput.value = trimmed
    }

    showMessage('グループ名を変更しました。', 'info')
    await loadAllData(groupId)
  } catch (error) {
    showMessage(error.message || 'グループ名の変更に失敗しました。', 'error')
  }
}

loginForm.addEventListener('submit', loginWithMagicLink)
signOutBtn.addEventListener('click', signOut)
cardForm.addEventListener('submit', saveCard)
addBaselineBtn.addEventListener('click', () => createBaselineRow())
addAppraisalBtn.addEventListener('click', () => createAppraisalRow())
reloadBtn.addEventListener('click', () => loadAllData(activeGroupId))
cancelEditBtn.addEventListener('click', () => resetForm(true))

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  toggleUiBySession()
  if (currentSession?.user) {
    loadAllData(activeGroupId)
  }
})

createBaselineRow()
updatePreview()
refreshSession()
