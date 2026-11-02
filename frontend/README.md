# Reactフロントエンド

React・TypeScript・Vite・TanStack Queryで画面を構成します。Pythonの認証・API・給与計算・セッション保存形式は共通のままです。

- `main.tsx`：ログイン／アプリの入口。
- `SessionGate.tsx`：初回・復帰時の認証確認、定期確認、非表示制御。
- `App.tsx`：3つのタブ、月選択、先読み、タブ別のスクロール位置。
- `pages.tsx`：カレンダー・スタッフ検索・給与概算。
- `Details.tsx`：日別／スタッフ詳細、戻る履歴、フォーカス・スクロール復元。
- `data.ts`・`hooks.ts`：既存キャッシュとTanStack Queryの接続、表示中の再取得。
- `style.css`：アプリ固有の配色・レイアウト。

`npm ci`で導入し、`npm run build`で型検査と配信用ファイルの作成、`npm test`で人工データによるキャッシュ・Reactの回帰テストを実行します。`npm run dev`はFlaskから配信するファイルを監視ビルドします。ブラウザではFlaskのURLを開き、変更後に再読み込みしてください。

## Arc Library

`registry/`と`lib/motion-tokens.ts`は[Arc Library](https://github.com/kuratlielia/arc-library)のMITライセンスのソースです。Button・Input・Tabs・Dialog・Skeleton・Badgeと共通トークンを、元のパス構成を保って取り込んでいます。ライセンスは`registry/LICENSE`に保存しています。Dialogの閉じるボタンは日本語に変更し、ブラウザ専用ビルドでは不要な`use client`宣言を除いています。Dialogの背景には認証確認中の非表示制御用クラスを追加しています。アプリ固有の見た目は`style.css`で上書きし、元のCSS変数を利用します。

外部CDNや外部フォントへのアクセスは不要です。OSのモーション軽減設定を尊重します。

## キャッシュの境界

`static/data-cache.js`の既存キャッシュを継続利用し、TanStack Queryは同じエントリーを観測します。上流の残存有効期間、月のリビジョン、最大3か月・100エントリーの制限を維持します。先読みも同じ取得経路を使います。React側の観測キャッシュも、既存キャッシュから除去されたエントリーを取得完了時に除去します。

従業員情報・シフトはメモリ内だけに保持し、HTTP応答の`no-store`を維持します。ログアウト・認証切れ・別タブでの認証変更・ページ離脱時にキャッシュを消し、通信を中止します。遅れて届いた応答は世代番号で破棄します。給与の入力設定だけは従来と同じ利用者別キーで`localStorage`へ保存します。
