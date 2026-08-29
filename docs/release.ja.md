# リリース手順

npmへの公開は兄弟ツールと同じく手元のマシンから行う。

```sh
npm run check
npm pack --dry-run
git status
npm version patch              # minor / major はsemverに従う
npm publish --access public
git push --follow-tags
```

`CHANGELOG.md`の`## Unreleased`には、変更ごとに`(EN)`と`(JA)`の行を記載する。
`npm version`はテストと型検査、変更履歴の空検査を行い、VERSION定数と変更履歴を同期する。
`npm publish`の`prepack`はbundleと型定義を再生成する。

`.github/workflows/release.yml`はTrusted Publishingを設定した場合に利用できる手動実行の予備で、
通常のタグpushからは発火しない。
