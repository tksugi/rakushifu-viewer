# 起動・デプロイガイド

Flask版はPC上で起動し、Workers版はWorkersのローカル開発環境またはCloudflare上で起動します。どちらも、ログインすると実際のらくしふへ接続します。初めて起動する場合は、必要なツールと利用する環境の手順を読んでください。設定一覧とトラブル対応は、必要なときに参照できます。

実アカウントでのログイン・シフト取得はFlask版で確認済みです。Workers版はローカル起動に加え、GitHub ActionsからのデプロイとCloudflare上での未認証時の応答を確認しています。Workers版の実ログイン・シフト取得は未確認です。

## 目次

- [必要なツール](#必要なツール)
- [Flask版の起動](#flask版の起動)
- [フロントエンドの開発](#フロントエンドの開発)
- [Workersの起動・デプロイ](#workersの起動デプロイ)
- [GitHub Actionsから自動デプロイする](#github-actionsから自動デプロイする)
- [アプリケーションの設定](#アプリケーションの設定)
- [トラブル対応](#トラブル対応)
- [検証範囲](#検証範囲)
- [用語](#用語)

## 必要なツール

| ツール・アカウント | Flask版 | Workers版 |
| --- | --- | --- |
| Python | 3.10以上 | 3.14（`>=3.14,<3.15`） |
| pip | ローカル依存の導入に使用 | 手順では使用しない |
| uv | 不要 | Python依存とpywranglerの実行に使用 |
| Node.js / npm | Node.js 22.12以上のLTS版。Reactのビルドに使用 | 同左。Wranglerもnpmで導入 |
| らくしふアカウント | すかいらーく向けの従業員アカウント | 同左 |
| Cloudflareアカウント | 不要 | クラウドへのデプロイ時に必要 |

Workersの依存は`pyproject.toml`と`uv.lock`、Workers向けのパッケージ固定は`pylock.toml`で管理しています。JWTにはPyJWT（MIT、HS256のみ）を使います。署名用の秘密はログイン時にセッションごとに生成・保存するため、新しい環境変数や共通鍵の登録は不要です。Workersの`pylock.toml`はPyodide用wheelとruntime SDKの固定を維持し、`uv lock`と`uv export --format pylock.toml --no-dev`で生成したPyJWTエントリーを追加しています。全体を汎用のexportで置き換えないでください。

Node.js側は`package.json`と`package-lock.json`を使います。Python Workersの開発・デプロイには、Cloudflareが案内する[pywrangler](https://developers.cloudflare.com/workers/languages/python/)を使用します。

## Flask版の起動

ソースを取得・展開したディレクトリに移動してから実行します。Pythonの仮想環境を作り、このアプリで使うライブラリを導入します。仮想環境をアクティブにする操作は不要です。

Windows / PowerShell:

```powershell
npm ci
npm run build
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-local.txt
$env:APP_ENV = "test"
.\.venv\Scripts\python.exe api.py
```

macOS / Linux:

```sh
npm ci
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-local.txt
APP_ENV=test .venv/bin/python api.py
```

ブラウザで[http://127.0.0.1:5000](http://127.0.0.1:5000)を開きます。未認証の場合はログイン画面へ移動します。従業員IDとパスワードを入力し、ログインしてください。

`api.py`は`127.0.0.1:5000`でFlaskの開発サーバーを起動します。終了は`Ctrl+C`です。プロセスを終了するとセッションが失われるため、次回起動時は再ログインします。公開サーバーとして運用する場合は、後述のWorkers版を使用できます。

ルートの`pyproject.toml`はWorkers向けにPython 3.14を要求します。Python 3.10でFlask版を動かすときは、`uv run`ではなく上記の`requirements-local.txt`を使う手順で導入してください。

## フロントエンドの開発

`npm run dev`はReactの配信用ファイルを監視ビルドします。別のターミナルでFlaskを起動し、FlaskのURLをブラウザで開いてください。変更後は再読み込みします。サンプルは`/sample`で利用できます。`npm test`は架空データだけで既存キャッシュとReactの取得・再試行・認証境界を検証します。`npm run build`では`frontend/`のTypeScript型検査も行います。画面とライブラリの構成は[フロントエンドの説明](../frontend/README.md)を参照してください。


## Workersの起動・デプロイ

### ビルド用ディレクトリを作成する

プロジェクトのルートで実行します。

```sh
npm ci
npm run build
python scripts/prepare_worker.py
cd .worker-build
```

`npm ci`はロックファイルに合わせてReactのビルド用依存とWranglerを導入します。`npm run build`はTypeScriptの型検査後、`static/react/`へ配信用ファイルを作成します。この生成物はコミットしません。`prepare_worker.py`は`.worker-build`に次のファイルを配置します。

| 配置先 | 内容 |
| --- | --- |
| `src/worker.py` | Workersの入口とDurable Objectのクラス |
| `src/app/` | Pythonコード。ローカル専用の通信・セッション・試行制限実装を除く |
| `src/templates/` | HTMLテンプレート |
| `public/static/` | CSSとJavaScript（ビルド済みの`static/react/`を含む） |
| ディレクトリ直下 | `wrangler.toml`、`pyproject.toml`、`uv.lock`、`pylock.toml` |

**スクリプトは既存の`.worker-build`全体を削除してから再作成します。** ローカルDurable Objectsのデータ、仮想環境、生成された依存も削除されます。クラウド上のDurable Objectsは、この操作では削除されません。

ルートの`wrangler.toml`は、この配置先を前提に`main = "src/worker.py"`、`assets.directory = "public"`を指定しています。pywranglerは`.worker-build`内で実行してください。

### Workersをローカルで起動する

```sh
uv run pywrangler dev
```

pywranglerがPython依存を準備し、Wranglerの開発サーバーを起動します。必要なPythonが見つからない場合はuvによる取得が発生します。ターミナルに表示されたURLをブラウザで開いてください。ポートを指定する場合は次のように実行します。

```sh
uv run pywrangler dev --port 8787
```

停止するときは`Ctrl+C`を押します。ローカルDurable Objectsの保存先は`.worker-build/.wrangler/state`です。クラウド上のデータとは別に保持されます。

Workersのローカル起動でも、`worker.py`が指定する`production`モードで動きます。これは保存方式を選ぶ設定であり、Cloudflare上へ接続しているという意味ではありません。らくしふとの通信は実際の接続です。単体テストのようなダミー応答にはなりません。

Workers版のアプリCookieには`Secure`を付けます。開発サーバーのURLでCookieが送信されない場合は、ブラウザのCookie情報と接続方式を確認してください。

### Cloudflareへデプロイする

`.worker-build`内で、利用するCloudflareアカウントにログインします。

```sh
npx wrangler login
uv run pywrangler deploy
```

`deploy`はアプリと静的ファイルをCloudflareにアップロードします。出力されたHTTPS URLを開いてください。公開名は`wrangler.toml`の`name = "rakushifu-viewer"`です。名前を変更する場合は、ルートの設定を変更してビルドを作り直します。

アカウントごとの従業員IDやパスワードをWranglerのsecretに登録する必要はありません。各利用者がログイン画面から入力します。公開後のログイン処理はCloudflare上で実行され、認証CookieはCloudflare上のDurable Objectsに保持されます。

デプロイ完了の出力だけでは、らくしふへの接続まで成功したとは確認できません。公開した環境では、次を確認してください。

1. 未認証でトップページを開くと、ログイン画面へ移動する。
2. CSS・JavaScriptが読み込まれる。
3. 対象アカウントでログインし、当月のシフトを表示できる。
4. 月を変更し、メンバー検索と給与概算を利用できる。
5. ログアウト後、認証が必要なAPIにアクセスすると`401`を返す。

### ソース変更を反映する

`.worker-build`内のコピーを直接編集しても、次のビルドで上書きされます。変更はルート側のソースに加えます。

開発サーバーを停止してプロジェクトのルートへ戻り、再作成します。

```sh
npm run build
python scripts/prepare_worker.py
cd .worker-build
uv run pywrangler dev
```

クラウドへ反映するときは、最後のコマンドを`uv run pywrangler deploy`に置き換えます。ローカルのビルドを作り直すと、ローカルでの再ログインが必要です。

### バインディングと配信設定

バインディングは、WorkerからCloudflareのストレージや静的ファイルへアクセスするための接続定義です。

| 設定 | 値・用途 |
| --- | --- |
| `compatibility_date` | `2026-09-30` |
| `compatibility_flags` | `python_workers` |
| `SESSIONS` | `SessionObject`。アプリのセッションを保持 |
| `LOGIN_LIMITS` | `LoginLimitObject`。ログイン試行回数を保持 |
| `ASSETS` | `public`内の静的ファイルを配信 |
| `assets.run_worker_first` | `true`。静的ファイルのリクエストもまずWorkerに渡す |
| `exports.SessionObject` | SQLiteを使うDurable Objectとして宣言 |
| `exports.LoginLimitObject` | SQLiteを使うDurable Objectとして宣言 |

`exports`はCloudflareの[Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/#exports)に沿ったクラス宣言です。同じDurable Object向けの`migrations`との併用はできません。

## GitHub Actionsから自動デプロイする

`.github/workflows/ci-deploy.yml`は、既存のローカルテストが成功した後にWorkersをデプロイします。実際のらくしふアカウントを使うログイン・シフト取得テストは実行しません。

| 起動条件 | 実行内容 |
| --- | --- |
| `main`へのpush | テスト後、成功した場合にデプロイ |
| `dev`へのpush | テストのみ |
| `main`・`dev`宛てのPull Request | テストのみ |
| Actions画面から手動実行 | テスト。選択ブランチが`main`の場合は成功後にデプロイ |

テストはPython 3.10で`requirements-local.txt`を導入し、`python -m unittest discover -s tests -v`を実行します。Node.js 22で`npm ci`・`npm test`・`npm run build`とWorkers配布ファイルの準備も確認します。デプロイは別ジョブでPython 3.14、Node.js 22、uv、Wranglerを準備します。`npm run build`と`prepare_worker.py`で画面と配布ファイルを作成し、`.worker-build`内で`uv run --locked pywrangler deploy`を実行します。

デプロイジョブはテストジョブの成功を条件とします。`main`の実行は直列化し、デプロイの途中で別のpushによるキャンセルを行いません。Pull Requestのテストは、新しい変更が届くと以前の実行をキャンセルします。

通常の変更はdev向けPRで「ローカルテスト」の結果を確認します。CI追加前のコミットや、この設定を含まないブランチではdev向けCIが動かない場合があるため、対象コミットで実際に実行された結果を確認してください。チェックが必須化されている場合、成功するまでマージできません。

### GitHub Secretsを登録する

1. Cloudflareで「Edit Cloudflare Workers」のAPIトークンを作成し、公開するアカウントにアクセス範囲を限定します。
2. 対象のCloudflareアカウントIDを確認します。
3. GitHubリポジトリの **Settings → Secrets and variables → Actions** を開き、次のRepository secretsを登録します。

| Secret名 | 登録する値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | デプロイ権限を持つCloudflareのAPIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 公開先のCloudflareアカウントID |

認証情報が未設定の場合、テストは実行されますが、デプロイジョブは設定不足のエラーで停止します。トークンをソースやWrangler設定へ記載する必要はありません。認証情報は、デプロイジョブの設定確認とデプロイ時に渡します。

Cloudflareのリポジトリ連携による本番自動デプロイを併用すると、同じpushに対して二つの公開処理が走る可能性があります。このワークフローで公開する場合は、Cloudflare側の本番自動デプロイを無効にしてください。認証設定はCloudflareの[GitHub Actionsガイド](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)にも記載されています。

### 実行結果を確認・再実行する

GitHubの **Actions → テストとCloudflareへのデプロイ** で、テストとデプロイの結果を確認します。成功したデプロイのログには、公開先のURLが表示されます。

初回は、Secretsの登録後に **Run workflow** から`main`を選択して実行できます。失敗した実行をやり直す場合は、その実行の **Re-run failed jobs** を使用します。APIトークンの期限切れや権限不足の場合は、Secretを更新してから再実行してください。

この自動テストは、実アカウントでの認証成功やシフト取得を確認するものではありません。公開後の確認手順は[Cloudflareへデプロイする](#cloudflareへデプロイする)を参照してください。

## アプリケーションの設定

環境変数として読み込むのは`APP_ENV`と`APP_COOKIE_SECURE`です。`.env`を自動で読み込む処理はありません。その他の値は`AppSettings`の既定値または`create_app(config=...)`のPython設定です。Wranglerの`vars`に追加するだけでは、これらのPython設定は変更されません。

| 設定 | 既定値 | 用途・変更箇所 |
| --- | --- | --- |
| `APP_ENV` | `test` | `test`か`production`。Workersは入口で`production`を指定 |
| `APP_COOKIE_SECURE` | ローカルは`false` | 環境変数が`true`なら有効。Workersでは入口で有効にする |
| `APP_COOKIE_NAME` | `app_session` | 移行前のCookieを削除するための名前。認証には使用しない |
| `APP_ACCESS_COOKIE_NAME` | `app_access` | 1時間有効のJWT Cookie名 |
| `APP_REFRESH_COOKIE_NAME` | `app_refresh` | 30日有効のJWT Cookie名 |
| `APP_ACCESS_SECONDS` | `3600`（1時間） | アクセストークンの寿命。セッションの残存期間以内に制限 |
| `APP_SESSION_SECONDS` | `2592000`（30日） | セッションの寿命。`AppSettings.session_seconds`から設定 |
| `CACHE_SECONDS` | `120` | 月別シフトのキャッシュ期間。`AppSettings.cache_seconds`から設定 |
| `MAX_CACHED_MONTHS` | `3` | セッションごとのキャッシュ上限。`AppSettings.max_cached_months`から設定 |
| `MAX_SESSIONS` | `500` | Flask版のメモリセッション上限。`create_app`の設定 |

`APP_ENV=production`を指定して`python api.py`を起動するとエラーになります。通常のFlaskプロセスでDurable Objectsを代替する実装はありません。また、Workers版でセッションストレージへの接続が失敗しても、メモリ方式へ切り替えません。

## トラブル対応

| 症状 | 確認・対処 |
| --- | --- |
| `No module named flask` / `requests` | 起動に使っているPythonで`requirements-local.txt`を導入したか確認 |
| Pythonのバージョンエラー | Flask版は3.10以上、Workersのプロジェクトは3.14が必要。導入方法を混同していないか確認 |
| `production requires the Python Workers runtime` | Flask版では`APP_ENV=test`を指定。Workers版はpywranglerから起動 |
| `src/worker.py` / `public`が見つからない | `prepare_worker.py`を実行し、`.worker-build`へ移動してから起動 |
| `SESSIONS` / `LOGIN_LIMITS` / `ASSETS`がない | ビルド先の`wrangler.toml`とバインディング名を確認 |
| ログイン後もログイン画面に戻る | `app_refresh` Cookieが保存・送信されているか確認。JWT移行直後は再ログインが必要。ログインから30日の期限、らくしふ側の認証失効やサーバー再起動も確認 |
| `429` | 同一IPまたはIPと従業員IDの組合せで試行上限に到達。5分の集計範囲から試行が外れるまで待つ |
| `502` | らくしふへの接続、認証の引き継ぎ、シフトの応答形式を確認 |
| `503` | Durable Objectsへのアクセスを確認。再ログインだけでは保存先の障害は解消しない |
| シフトの変更がすぐ表示されない | 取得から約120秒を目安に表示中の画面を自動更新。非表示の間は停止。更新失敗時は前回の内容と最終取得時刻を表示 |
| 再ビルド後にローカルのログインが失われた | ビルド先とともにローカル保存データが消えたため、再ログインする |

APIのエラー形式は[技術仕様](architecture.md#http-api)に、画面上の操作と計算範囲は[利用ガイド](usage.md)に記載しています。

解決しない不具合はGitHub Issuesで受け付けます。[報告に必要な情報](../README.md#不具合報告開発参加)を添えてください。

## 検証範囲

ローカル用Python環境で`python -m unittest discover -s tests -v`を実行します。Node.js 22.12以上のLTS版で`npm ci`・`npm test`・`npm run build`を実行すると、キャッシュ基盤とReact画面の回帰テスト、型検査、配信用ファイルの作成を確認できます。CIも同じ検証とWorkers配布ファイルの準備を実行します。実ブラウザの操作とWorkersランタイムは別途確認します。

| 対象 | 確認状況 |
| --- | --- |
| Flask版の実ログイン・シフト取得 | 確認済み |
| 人工データによるテスト | 20テスト通過。実通信は行わない |
| Workersのローカル起動 | 起動、バインディング、ログイン画面、静的ファイル、未認証APIを確認 |
| Workersからの実ログイン・シフト取得 | 未確認 |
| GitHub Actionsからのテスト・デプロイ | 既存の20件のテストとCloudflareへのデプロイが成功 |
| Cloudflare上での未認証時の応答 | ログイン画面と静的ファイルはHTTP 200、未認証APIはHTTP 401を確認 |

Windowsで起動手順を確認しています。macOS / Linuxのコマンドは掲載していますが、実行確認はしていません。

## 用語

| 用語 | 意味 |
| --- | --- |
| 仮想環境 | アプリ用のPythonライブラリを分けて導入する環境 |
| pywrangler | Python Workersの依存準備とWranglerの呼び出しを行うCLI |
| バインディング | WorkerからCloudflareのリソースへ接続する定義 |
| Durable Object | セッションなどの状態とストレージをObject単位で管理するWorkersの仕組み |

[READMEに戻る](../README.md)

## リリース時のマージ方法

通常の作業PRはdevへsquash mergeし、リリースはdevからmainへmerge commitで取り込みます。GitHubのmain-protectionはmerge commitだけを許可し、hotfixも同じ方法で取り込みます。dev-protectionはsquash mergeだけを許可します。

リリースをsquashすると、同じ内容が両ブランチにあっても履歴がつながらず、次回のリリースで競合する場合があります。リリース前には両ブランチの履歴、差分、対象コミットのCIを確認してください。mainへのマージはテスト成功後の自動デプロイを伴うため、明示的なリリース承認を受けてから実行します。

過去のsquashによる履歴の分断を復旧する場合は、最新devから専用ブランチを作り、mainをmergeして両側の変更を確認・競合解消します。そのブランチからmain向けPRを作り、merge commitで取り込むと、devの履歴を保ったまま再接続できます。通常のリリースはdevからmainへのPRに戻します。競合が起きない保証ではなく、同じ変更の重複取り込みによる競合を防ぐ手順です。
