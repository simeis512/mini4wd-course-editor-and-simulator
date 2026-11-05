// The changelog and the app's version (#137, owner 2026-10-30).
//
// Each PR that changes what users see adds `changes/<PR number>.md`:
//
//   ---
//   type: feat          feat → 0.(x+1).0, fix → 0.x.(y+1), none → no new version
//   url-format: 8       only when FORMAT_VERSION (src/course/codec.ts) changes
//   ---
//
//   - 追加：…           one line each, starting 追加／修正／変更／その他
//
// On merge to main a GitHub Action runs `compile`, which writes the
// fragments into CHANGELOG.md, bumps package.json and deletes them, so
// PRs made side by side never touch the same lines. `check` runs on PRs.
//
//   node scripts/changes.mjs compile [date]
//   node scripts/changes.mjs check <PR number> <base ref>

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TYPES = ['feat', 'fix', 'none'];
export const KINDS = ['追加', '修正', '変更', 'その他'];
/** Paths whose change users can see: a PR touching them needs a fragment. */
export const USER_FACING = [/^src\//, /^index\.html$/, /^public\//];

/** Read a fragment; throws with what is wrong. */
export function parseFragment(text, name = 'fragment') {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${name}: 先頭に --- で囲んだ type: の行が要ります`);
  const head = Object.fromEntries(
    m[1].split('\n').filter((l) => l.trim()).map((l) => {
      const i = l.indexOf(':');
      if (i < 0) throw new Error(`${name}: 「${l}」は「名前: 値」の形にしてください`);
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  const type = head.type;
  if (!TYPES.includes(type)) throw new Error(`${name}: type は ${TYPES.join(' / ')} のどれかです（「${type ?? ''}」）`);
  let urlFormat = null;
  if (head['url-format'] !== undefined) {
    urlFormat = Number(head['url-format']);
    if (!Number.isInteger(urlFormat) || urlFormat < 1) throw new Error(`${name}: url-format は形式の番号（整数）です`);
  }
  const lines = m[2].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const t = /^- (.+?)：(.+)$/.exec(l);
    if (!t || !KINDS.includes(t[1])) throw new Error(`${name}: 「${l}」は「- ${KINDS.join('／')}：…」で始めてください`);
    return l.slice(2);
  });
  if (type !== 'none' && !lines.length && urlFormat === null) throw new Error(`${name}: ${type} なら変更点を 1 行以上書いてください`);
  return { type, urlFormat, lines };
}

/** The version after a change of `type`. */
export function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'feat') return `${major}.${minor + 1}.0`;
  if (type === 'fix') return `${major}.${minor}.${patch + 1}`;
  return version;
}

/** The line that says the share URL format changed (#137: every such version has one). */
export function urlFormatLine(n) {
  return n === 1
    ? '共有 URL：形式 1 で URL にコースを入れて共有できます'
    : `共有 URL：形式を ${n} にしました。古い URL もそのまま開けます。この版より前のアプリでは新しい URL は開けません`;
}

const HEADER = '# 更新履歴\n\n使う人から見た変更を、新しい順に書いています。番号は 0.x のあいだ、機能を足すと 2 つ目、不具合を直すと 3 つ目が上がります（実測を反映し終えたら 1.0.0）。\n';

/**
 * Write fragments, oldest PR first, into the changelog `text`. A fragment
 * that brings no new version adds its lines to the newest one.
 */
export function compile(text, version, fragments, date) {
  const body = text.startsWith('# ') ? text.slice(text.indexOf('\n## ') + 1 || text.length) : text;
  let sections = body.trim() ? body.trim().split(/\n(?=## )/).map((s) => s.trim()) : [];
  for (const f of [...fragments].sort((a, b) => a.pr - b.pr)) {
    const lines = [...f.lines, ...(f.urlFormat !== null ? [urlFormatLine(f.urlFormat)] : [])].map((l) => `- ${l}（#${f.pr}）`);
    const next = bump(version, f.type);
    if (next !== version || !sections.length) {
      version = next;
      sections = [`## v${version}（${date}）\n\n${lines.join('\n')}`, ...sections];
    } else if (lines.length) {
      sections[0] = `${sections[0]}\n${lines.join('\n')}`;
    }
  }
  return { text: `${HEADER}\n${sections.join('\n\n')}\n`, version };
}

/** The value of FORMAT_VERSION in codec.ts source. */
export function formatVersion(source) {
  const m = /export const FORMAT_VERSION = (\d+)/.exec(source);
  return m ? Number(m[1]) : null;
}

/** What is wrong with a PR's fragment, or nothing. */
export function checkPr({ pr, changed, fragment, oldFormat, newFormat }) {
  const errors = [];
  const name = `changes/${pr}.md`;
  let parsed = null;
  if (fragment !== null) {
    try {
      parsed = parseFragment(fragment, name);
    } catch (e) {
      errors.push(e.message);
    }
  } else if (changed.some((p) => USER_FACING.some((r) => r.test(p)))) {
    errors.push(`${name} がありません。画面やコードを変える PR は更新履歴の断片を足してください（載せないなら type: none）`);
  }
  if (oldFormat !== newFormat) {
    if (fragment === null) errors.push(`FORMAT_VERSION が ${oldFormat} → ${newFormat} に変わりました。${name} に url-format: ${newFormat} を書いてください`);
    else if (parsed && parsed.urlFormat !== newFormat) errors.push(`FORMAT_VERSION が ${newFormat} になりました。${name} に url-format: ${newFormat} を書いてください`);
  }
  return errors;
}

function today() {
  // Dates in Japan time, where the owner is.
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

function main([cmd, ...args]) {
  if (cmd === 'compile') {
    const files = existsSync('changes') ? readdirSync('changes').filter((f) => /^\d+\.md$/.test(f)) : [];
    if (!files.length) return console.log('断片はありません');
    const fragments = files.map((f) => ({ pr: Number(f.slice(0, -3)), ...parseFragment(readFileSync(`changes/${f}`, 'utf8'), `changes/${f}`) }));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const log = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : '';
    const { text, version } = compile(log, pkg.version, fragments, args[0] ?? today());
    writeFileSync('CHANGELOG.md', text);
    for (const file of ['package.json', 'package-lock.json']) {
      if (!existsSync(file)) continue;
      const json = JSON.parse(readFileSync(file, 'utf8'));
      json.version = version;
      if (json.packages?.['']) json.packages[''].version = version;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    }
    for (const f of files) rmSync(`changes/${f}`);
    console.log(`v${version}`);
  } else if (cmd === 'check') {
    const [pr, base] = args;
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    const name = `changes/${pr}.md`;
    const old = (() => {
      try {
        return git('show', `${base}:src/course/codec.ts`);
      } catch {
        return '';
      }
    })();
    const errors = checkPr({
      pr,
      changed,
      fragment: existsSync(name) ? readFileSync(name, 'utf8') : null,
      oldFormat: formatVersion(old),
      newFormat: formatVersion(readFileSync('src/course/codec.ts', 'utf8')),
    });
    for (const f of readdirSync('changes').filter((f) => /^\d+\.md$/.test(f) && `changes/${f}` !== name && changed.includes(`changes/${f}`))) {
      errors.push(`changes/${f}：断片のファイル名はこの PR の番号（${name}）にしてください`);
    }
    if (errors.length) {
      for (const e of errors) console.error(`::error::${e}`);
      process.exit(1);
    }
    console.log('更新履歴の断片 OK');
  } else {
    console.error('使い方: node scripts/changes.mjs compile [date] | check <PR番号> <base>');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
