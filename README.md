# カード価格比較アプリ（Supabase + 静的HTML最小構成）

## 構成
- フロント: `index.html` + `app.js` + `style.css`
- 認証: Supabase Auth（メールマジックリンク）
- DB: Supabase Postgres
- 画像保存: Supabase Storage

## できること
- カード画像の登録
- カード名の登録
- 店舗ごとの最高販売価格を複数件登録
- 査定後価格の登録
- 店舗最高値と差額の自動計算
- 登録済みカードの一覧表示
- カード削除

## 事前準備
1. Supabase プロジェクトを作成する
2. Supabase の SQL Editor で `schema.sql` を実行する
3. Authentication → URL Configuration で以下を設定する
   - Site URL: あなたの公開URL
   - Redirect URLs: あなたの公開URL（必要なら `http://localhost:5500` なども追加）
4. `config.example.js` を `config.js` にコピーして、以下を設定する
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. `index.html` など一式を静的ホスティングへ配置する

## ローカルで試す簡単な方法
VS Code の Live Server など、静的ファイルを配信できる方法で開いてください。
`file://` 直開きではなく、`http://localhost:xxxx` で開くのがおすすめです。

## 公開先の例
- Cloudflare Pages
- Netlify
- GitHub Pages
- Vercel の静的配信

## 補足
- このサンプルは実装を簡単にするため、画像バケットを `public` にしています。
- 画像は `ユーザーID/ランダムファイル名` で保存されます。
- 画像サイズは 6MB 以下に制限しています。
- 差額は保存せず、画面表示時に自動計算しています。
