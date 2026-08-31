# リリース手順

[English](release.md) | 日本語

この文書はmaintainer向けです。npmへの公開は兄弟ツールと同じく、通常は手元のマシンから行います。

## リリース前確認

1. `main`が最新で、意図しない変更がないことを確認する。
2. [README](../README.ja.md)、[初心者向けガイド](GUIDE.ja.md)、
   [上級ガイド](ADVANCED.ja.md)、[CLIリファレンス](CLI.ja.md)、変更履歴を確認する。
3. CLIで単一画像、directory bundle、透過、preview、`--check`の代表操作を確認する。
4. Web版をChromium系とFirefoxで開き、複数画像、同名差替え、透過と背景切替、変換後preview、
   project ZIPと各download、設定のdrop/import/export、日英切替を確認する。
5. `main` push後は<https://tanakamasayuki.github.io/GfxImageToolJs/>を直接開き、assetの404や
   古いcacheがなく、公開buildが同じ動作をすることを確認する。

自動検査:

```sh
npm run check
npm run build
npm run types
npm run smoke:dist
npm run build:site
npm pack --dry-run
git diff --check
git status --short
```

`npm pack --dry-run`では、`bin`、`dist`、`docs`、`src`、`types`、README、CHANGELOG、LICENSEが
入り、test fixture、`web`、`site`、native binaryが入らないことを確認します。Web版はnpm tarballでは
なくGitHub Pagesから配信します。

## 変更履歴とversion

`CHANGELOG.md`の`## Unreleased`には、変更ごとに`(EN)`と`(JA)`の行を対にして記載します。
releaseする差分がすべて説明され、空でないことを確認します。

`npm version`は次を自動実行します。

- `preversion`: test、typecheck、locale検査、release可能性の検査
- `version`: package version、sourceのVERSION定数、CHANGELOG見出しの同期
- commitとGit tagの作成

初回公開を含め、実際に公開するversionを先に決めます。既に`package.json`に目的versionが設定されて
いる場合は、不用意にpatchを1つ進めないでください。versionを変更する場合はsemverに従います。

```sh
npm version patch              # 必要に応じて minor / major
```

## npm公開とpush

npm login状態、package名、公開先accountを確認してから実行します。

```sh
npm publish --access public
git push --follow-tags
```

`npm publish`の`prepack`はbundleと型定義を再生成します。publish後は、別の一時directoryで公開packageの
version、root import、`gfx-image-tool --version`を確認します。npm tokenや認証情報はrepositoryへ置きません。

## GitHub Actions

- `ci.yml`: `main` pushとpull requestでcheck、build、types、dist smoke、site build、pack内容を検査
- `pages.yml`: `main` pushまたは手動実行でGitHub Pagesをdeploy
- `release.yml`: Trusted Publishingを設定した場合に使える手動publishの予備

通常のtag pushから`release.yml`は発火しません。CI publishへ切り替える場合はnpm Trusted Publishingと
provenanceを使用します。

## リリース後

- npm package pageに目的versionが表示されること
- `npm install --global gfx-image-tool`後にCLIが起動すること
- Git tagとGitHub上のcommitが一致すること
- [Web版](https://tanakamasayuki.github.io/GfxImageToolJs/)が最新versionで動くこと
- CHANGELOGと日英ドキュメントのリンクが公開先で開くこと

問題があった場合は同じversionを上書きせず、修正して新しいpatch versionを公開します。
