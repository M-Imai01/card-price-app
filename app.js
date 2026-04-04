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
const baselineShopNameInput = document.getElementById('baselineShopNameInput')
const baselineHighestPriceInput = document.getElementById('baselineHighestPriceInput')
const addAppraisalBtn = document.getElementById('addAppraisalBtn')
const appraisalsContainer = document.getElementById('appraisalsContainer')
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
let loadedCards = []
let editingCardId = null
let editingImagePath = null

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
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getGapValue(baselinePrice, appraisalPrice) {
  return Number(baselinePrice || 0) - Number(appraisalPrice || 0)
}

function getGapClass(diff) {
  if (Number(diff) > 0) return 'gap-loss'
  if (Number(diff) < 0) return 'gap-gain'
  return ''
}

function computeCardMetrics(baselinePrice, appraisals) {
  const highestAppraisal = appraisals.length
    ? Math.max(...appraisals.map((row) => Number(row.appraisal_price ?? row.appraisalPrice ?? 0)))
    : 0
  const gap = getGapValue(baselinePrice, highestAppraisal)
  return {
    baselinePrice: Number(baselinePrice || 0),
    highestAppraisal,
    gap
  }
}

function computeGroupMetrics(cards) {
  const totalBaseline = cards.reduce((sum, card) => sum + Number(card.baseline_highest_price || 0), 0)
  const totalHighestAppraisal = cards.reduce((sum, card) => {
    const metrics = computeCardMetrics(card.baseline_highest_price, card.card_appraisals || [])
    return sum + metrics.highestAppraisal
  }, 0)
  return {
    totalBaseline,
    totalHighestAppraisal,
    totalGap: totalBaseline - totalHighestAppraisal
  }
}

function renderPreview() {
  const baselinePrice = Number(baselineHighestPriceInput.value || 0)
  const appraisals = collectAppraisals()
  const metrics = computeCardMetrics(baselinePrice, appraisals)
  baselinePreview.textContent = formatYen(metrics.baselinePrice)
  maxAppraisalPreview.textContent = formatYen(metrics.highestAppraisal)
  gapPreview.textContent = formatYen(metrics.gap)
  gapPreview.className = getGapClass(metrics.gap)
}

function createAppraisalRow(values = {}) {
  const row = document.createElement('div')
  row.className = 'appraisal-row'

  const shopName = values.shop_name || values.shopName || ''
  const appraisalPrice = values.appraisal_price ?? values.appraisalPrice ?? ''

  row.innerHTML = `
    <label>
      査定を出した店舗名
      <input type="text" class="shop-name" placeholder="例: B店" value="${escapeHtml(shopName)}" />
    </label>
    <label>
      査定価格（円）
      <input type="number" min="0" step="1" class="appraisal-price" placeholder="例: 9800" value="${appraisalPrice}" />
    </label>
    <div class="row-gap-box">
      <span class="label">基準との差額</span>
      <strong class="row-gap-value">0円</strong>
    </div>
    <button type="button" class="danger small remove-appraisal">削除</button>
  `

  const updateRowGap = () => {
    const baselinePrice = Number(baselineHighestPriceInput.value || 0)
    const appraisalValue = Number(row.querySelector('.appraisal-price').value || 0)
    const gap = getGapValue(baselinePrice, appraisalValue)
    const gapEl = row.querySelector('.row-gap-value')
    gapEl.textContent = formatYen(gap)
    gapEl.className = `row-gap-value ${getGapClass(gap)}`.trim()
    renderPreview()
  }

  row.querySelector('.remove-appraisal').addEventListener('click', () => {
    row.remove()
    renderPreview()
  })

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRowGap)
  })

  appraisalsContainer.appendChild(row)
  updateRowGap()
}

function getAppraisalRows() {
  return [...appraisalsContainer.querySelectorAll('.appraisal-row')]
}

function collectAppraisals() {
  return getAppraisalRows()
    .map((row) => ({
      shopName: row.querySelector('.shop-name').value.trim(),
      appraisalPrice: Number(row.querySelector('.appraisal-price').value || 0)
    }))
    .filter((row) => row.shopName && Number.isFinite(row.appraisalPrice) && row.appraisalPrice >= 0)
}

function resetForm() {
  editingCardId = null
  editingImagePath = null
  cardForm.reset()
  appraisalsContainer.innerHTML = ''
  createAppraisalRow()
  editModeBar.classList.add('hidden')
  editModeText.textContent = '登録済みカードを編集中です。'
  saveBtn.textContent = 'カードを登録'
  renderPreview()
}

function startEdit(cardId) {
  const card = loadedCards.find((item) => item.id === cardId)
  if (!card) return

  editingCardId = card.id
  editingImagePath = card.image_path

  groupNameInput.value = card.appraisal_group?.group_name || ''
  cardNameInput.value = card.card_name || ''
  baselineShopNameInput.value = card.baseline_shop_name || ''
  baselineHighestPriceInput.value = card.baseline_highest_price || ''

  appraisalsContainer.innerHTML = ''
  if (card.card_appraisals?.length) {
    ;[...card.card_appraisals]
      .sort((a, b) => Number(b.appraisal_price) - Number(a.appraisal_price))
      .forEach((row) => createAppraisalRow(row))
  } else {
    createAppraisalRow()
  }

  editModeBar.classList.remove('hidden')
  editModeText.textContent = `「${card.card_name}」を編集中です。保存すると内容を更新します。`
  saveBtn.textContent = '変更を保存'
  renderPreview()
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
    loadAll()
  } else {
    groupsList.innerHTML = ''
    groupSuggestions.innerHTML = ''
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
  resetForm()
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

async function deleteImageIfExists(imagePath) {
  if (!imagePath) return
  const { error } = await supabaseClient.storage.from(BUCKET).remove([imagePath])
  if (error) {
    console.warn(error)
  }
}

async function getOrCreateGroup(groupName) {
  const trimmed = groupName.trim()
  const { data, error } = await supabaseClient
    .from('appraisal_groups')
    .upsert(
      {
        user_id: currentSession.user.id,
        group_name: trimmed,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id,group_name' }
    )
    .select('id, group_name')
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
  const baselineShopName = baselineShopNameInput.value.trim()
  const baselineHighestPrice = Number(baselineHighestPriceInput.value)
  const appraisals = collectAppraisals()
  const file = imageInput.files?.[0]

  if (!groupName) {
    showMessage('査定グループ名を入力してください。', 'error')
    return
  }
  if (!cardName) {
    showMessage('カード名を入力してください。', 'error')
    return
  }
  if (!baselineShopName) {
    showMessage('基準価格を記録した店舗名を入力してください。', 'error')
    return
  }
  if (!Number.isFinite(baselineHighestPrice) || baselineHighestPrice < 0) {
    showMessage('基準となる最高販売価格を正しく入力してください。', 'error')
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

  saveBtn.disabled = true

  try {
    const group = await getOrCreateGroup(groupName)

    let imagePath = editingImagePath
    if (file) {
      imagePath = await uploadImage(file, currentSession.user.id)
    }

    if (!editingCardId) {
      const { data: insertedCard, error: insertCardError } = await supabaseClient
        .from('cards')
        .insert({
          user_id: currentSession.user.id,
          group_id: group.id,
          card_name: cardName,
          image_path: imagePath,
          baseline_shop_name: baselineShopName,
          baseline_highest_price: baselineHighestPrice,
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (insertCardError) throw insertCardError

      if (appraisals.length) {
        const appraisalRows = appraisals.map((row) => ({
          user_id: currentSession.user.id,
          card_id: insertedCard.id,
          shop_name: row.shopName,
          appraisal_price: row.appraisalPrice
        }))

        const { error: appraisalError } = await supabaseClient
          .from('card_appraisals')
          .insert(appraisalRows)

        if (appraisalError) throw appraisalError
      }
    } else {
      const oldImagePath = editingImagePath

      const { error: updateCardError } = await supabaseClient
        .from('cards')
        .update({
          group_id: group.id,
          card_name: cardName,
          image_path: imagePath,
          baseline_shop_name: baselineShopName,
          baseline_highest_price: baselineHighestPrice,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingCardId)

      if (updateCardError) throw updateCardError

      const { error: deleteAppraisalsError } = await supabaseClient
        .from('card_appraisals')
        .delete()
        .eq('card_id', editingCardId)

      if (deleteAppraisalsError) throw deleteAppraisalsError

      if (appraisals.length) {
        const appraisalRows = appraisals.map((row) => ({
          user_id: currentSession.user.id,
          card_id: editingCardId,
          shop_name: row.shopName,
          appraisal_price: row.appraisalPrice
        }))

        const { error: appraisalInsertError } = await supabaseClient
          .from('card_appraisals')
          .insert(appraisalRows)

        if (appraisalInsertError) throw appraisalInsertError
      }

      if (file && oldImagePath && oldImagePath !== imagePath) {
        await deleteImageIfExists(oldImagePath)
      }
    }

    const successText = editingCardId ? '更新しました。' : '保存しました。'
    resetForm()
    showMessage(successText, 'info')
    await loadAll()
  } catch (error) {
    showMessage(error.message || '保存に失敗しました。', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

function buildCardHtml(card) {
  const appraisals = [...(card.card_appraisals || [])].sort((a, b) => Number(b.appraisal_price) - Number(a.appraisal_price))
  const metrics = computeCardMetrics(card.baseline_highest_price, appraisals)
  const publicUrl = supabaseClient.storage.from(BUCKET).getPublicUrl(card.image_path).data.publicUrl

  const appraisalRowsHtml = appraisals.length
    ? appraisals.map((row) => {
        const gap = getGapValue(card.baseline_highest_price, row.appraisal_price)
        return `
          <tr>
            <td>${escapeHtml(row.shop_name)}</td>
            <td>${formatYen(row.appraisal_price)}</td>
            <td class="${getGapClass(gap)}">${formatYen(gap)}</td>
          </tr>
        `
      }).join('')
    : `
      <tr>
        <td colspan="3" class="meta">まだ査定結果がありません。</td>
      </tr>
    `

  return `
    <article class="card-item">
      <img class="card-image" src="${publicUrl}" alt="${escapeHtml(card.card_name)}" />
      <div class="card-body">
        <div class="card-title-row">
          <div>
            <h3>${escapeHtml(card.card_name)}</h3>
            <p class="meta">更新日: ${new Date(card.updated_at || card.created_at).toLocaleString('ja-JP')}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="secondary small edit-card" data-card-id="${card.id}">編集</button>
            <button type="button" class="danger small delete-card" data-card-id="${card.id}" data-image-path="${escapeHtml(card.image_path)}">削除</button>
          </div>
        </div>

        <div class="card-baseline-box">
          <div class="meta">基準となる最高販売価格</div>
          <div><strong>${escapeHtml(card.baseline_shop_name || '未設定')}</strong></div>
          <div><strong>${formatYen(card.baseline_highest_price)}</strong></div>
        </div>

        <div class="card-metrics">
          <div class="metric-box">
            <div class="meta">最高査定価格</div>
            <strong>${formatYen(metrics.highestAppraisal)}</strong>
          </div>
          <div class="metric-box">
            <div class="meta">基準との差額</div>
            <strong class="${getGapClass(metrics.gap)}">${formatYen(metrics.gap)}</strong>
          </div>
        </div>

        <table class="appraisal-table">
          <thead>
            <tr>
              <th>査定店舗</th>
              <th>査定価格</th>
              <th>基準との差額</th>
            </tr>
          </thead>
          <tbody>
            ${appraisalRowsHtml}
          </tbody>
        </table>
      </div>
    </article>
  `
}

function renderGroupSuggestions(cards) {
  const uniqueNames = [...new Set(cards.map((card) => card.appraisal_group?.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
  groupSuggestions.innerHTML = uniqueNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('')
}

function renderGroups(cards) {
  if (!cards.length) {
    groupsList.innerHTML = '<div class="empty">まだ登録がありません。</div>'
    return
  }

  const groupMap = new Map()
  cards.forEach((card) => {
    const groupId = card.appraisal_group?.id || '__ungrouped__'
    const groupName = card.appraisal_group?.group_name || '未分類'
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, { id: groupId, groupName, cards: [] })
    }
    groupMap.get(groupId).cards.push(card)
  })

  const groups = [...groupMap.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'))

  groupsList.innerHTML = groups.map((group) => {
    const metrics = computeGroupMetrics(group.cards)
    const cardsHtml = group.cards
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .map(buildCardHtml)
      .join('')

    return `
      <section class="group-block">
        <div class="group-header">
          <div class="row between center wrap-gap">
            <div>
              <h3>${escapeHtml(group.groupName)}</h3>
              <p class="meta">カード ${group.cards.length}枚</p>
            </div>
          </div>
          <div class="group-summary">
            <div class="summary-cell">
              <div class="meta">基準となる最高販売価格 合計</div>
              <strong>${formatYen(metrics.totalBaseline)}</strong>
            </div>
            <div class="summary-cell">
              <div class="meta">最高査定価格 合計</div>
              <strong>${formatYen(metrics.totalHighestAppraisal)}</strong>
            </div>
            <div class="summary-cell">
              <div class="meta">基準との差額 合計</div>
              <strong class="${getGapClass(metrics.totalGap)}">${formatYen(metrics.totalGap)}</strong>
            </div>
          </div>
        </div>
        <div class="group-cards-grid">
          ${cardsHtml}
        </div>
      </section>
    `
  }).join('')

  groupsList.querySelectorAll('.edit-card').forEach((button) => {
    button.addEventListener('click', () => startEdit(button.dataset.cardId))
  })

  groupsList.querySelectorAll('.delete-card').forEach((button) => {
    button.addEventListener('click', async () => {
      await deleteCard(button.dataset.cardId, button.dataset.imagePath)
    })
  })
}

async function loadAll() {
  if (!currentSession?.user) return

  groupsList.innerHTML = '<div class="empty">読み込み中...</div>'

  const { data, error } = await supabaseClient
    .from('cards')
    .select(`
      id,
      user_id,
      group_id,
      card_name,
      image_path,
      baseline_shop_name,
      baseline_highest_price,
      created_at,
      updated_at,
      appraisal_group:appraisal_groups (
        id,
        group_name
      ),
      card_appraisals (
        id,
        shop_name,
        appraisal_price,
        created_at,
        updated_at
      )
    `)
    .order('updated_at', { ascending: false })

  if (error) {
    showMessage(error.message, 'error')
    groupsList.innerHTML = ''
    return
  }

  loadedCards = data || []
  renderGroupSuggestions(loadedCards)
  renderGroups(loadedCards)
}

async function deleteCard(cardId, imagePath) {
  const ok = window.confirm('このカードデータを削除しますか？')
  if (!ok) return

  try {
    await deleteImageIfExists(imagePath)

    const { error } = await supabaseClient
      .from('cards')
      .delete()
      .eq('id', cardId)

    if (error) throw error

    if (editingCardId === cardId) {
      resetForm()
    }

    showMessage('削除しました。', 'info')
    await loadAll()
  } catch (error) {
    showMessage(error.message || '削除に失敗しました。', 'error')
  }
}

loginForm.addEventListener('submit', loginWithMagicLink)
signOutBtn.addEventListener('click', signOut)
cardForm.addEventListener('submit', saveCard)
addAppraisalBtn.addEventListener('click', () => createAppraisalRow())
baselineHighestPriceInput.addEventListener('input', renderPreview)
reloadBtn.addEventListener('click', loadAll)
cancelEditBtn.addEventListener('click', resetForm)

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  toggleUiBySession()
})

createAppraisalRow()
renderPreview()
refreshSession()
