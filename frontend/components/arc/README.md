# Arcのローディング表示

[Arc Library](https://github.com/kuratlielia/arc-library)のSkeletonのプレースホルダー部分とButtonのスピナーを、MITライセンスの下で取り込んでいます。

- 元のソース：`registry/components/skeleton/skeleton.tsx`、`skeleton.module.css`、`registry/components/button/button.module.css`。
- 取得日：2026-11-02。
- 変更点：使用するローディング部分だけを切り出し、色・角丸を既存アプリの変数へ接続。使用しないコンテンツ切り替え・高さアニメーション・Motion依存・グローバルテーマは取り込みません。
- 読み込み状態は`role="status"`・`aria-label`・`aria-busy`で伝え、画面にはテキストを表示しません。
- モーション軽減時はアニメーションを停止します。

ライセンスは同じフォルダーの`LICENSE`を参照してください。配布用にも`static/arc-LICENSE.txt`を同梱し、Flask・Workersから配信します。
