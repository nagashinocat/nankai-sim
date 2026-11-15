/**
 * 「避難場所のデータをこのスマホに保存」の欄（#near と結果画面）。
 * 保存するのは公開データ（国土地理院 指定緊急避難場所）だけ。localStorage には日付と件数だけ。
 */
import {
  clearSheltersSaved, deleteSavedShelters, hasNewerData, isShelterIndex, loadSheltersSaved, saveShelters, savedDateText, savedIndex, sizeText, today,
  writeSheltersSaved, type CachesLike, type ShelterIndex,
} from '../offline.ts';
import {
  SKIPPED, autoEligible, autoStatus, clearAutoPending, isAutoOff, onAutoStatus, setAutoOff, stopAutoSave, withSaveLock,
} from '../autosave.ts';
import { el } from './dom.ts';

export type OfflinePanelDeps = {
  /** 例: https://example.com/app/data */
  base: string;
  store: Storage | null;
  caches: CachesLike | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  online(): boolean;
  /** このアプリが自動保存をするか（本番ビルドで Service Worker が使えるとき） */
  auto?: boolean;
  /** データセーバー（navigator.connection.saveData） */
  saveData?(): boolean;
  /** タブどうしのロック（navigator.locks） */
  locks?: Pick<LockManager, 'request'> | null;
};

/** この端末で自動保存をするか（電波・保存の有無は見ない）。 */
export function panelAutoEligible(d: Pick<OfflinePanelDeps, 'auto' | 'caches' | 'saveData' | 'store'>): boolean {
  return !!d.auto && autoEligible({ hasCaches: !!d.caches, saveData: d.saveData?.() ?? false, autoOff: isAutoOff(d.store) });
}

export const OFFLINE_TEXT = {
  title: '電波がなくても使えるように',
  save: (size: string) => `避難場所のデータをこのスマホに保存（${size}）`,
  resave: '保存し直す',
  remove: '保存したデータを消す',
  what: '保存するのは、公開されている避難場所のデータ（5県の指定緊急避難場所）だけです。現在地や住所は保存しません。保存しておくと、電波がなくても「いまいる場所から近い避難場所」が出せます（現在地は GPS で取れます）。',
  notSaved: 'まだ保存していません。',
  saved: (date: string, count: number) => `保存済み（${date}・${count.toLocaleString()}か所）`,
  newer: '新しいデータがあります。保存し直してください。',
  saving: (done: number, total: number) => `保存しています… ${done}/${total}`,
  done: '保存しました。電波がなくても近い避難場所が出せます。',
  failed: (done: number, total: number) => `途中で止まりました（${done}/${total}）。電波のよい所で、もう一度押すと続きから保存します。`,
  offline: '電波があるときに保存してください。',
  noIndex: '保存するデータの一覧を読み込めませんでした。電波のよい所で、もう一度開いてください。',
  unsupported: 'このブラウザでは保存できません（プライベートブラウズなど）。',
  removed: '保存したデータを消しました。',
  autoSaved: (date: string, count: number) => `✅ 電波がなくても使えます（${date}に自動で保存・${count.toLocaleString()}か所）`,
  autoSaving: '電波がなくても使えるように、避難場所のデータを保存しています…（自動）',
  autoEvict: '一度も開いていないスマホでは使えません／iPhone はしばらく開かないと消えることがあります。ホーム画面に追加すると消えにくくなります',
  evict: 'しばらく開かないと、スマホが保存したデータを消すことがあります。ホーム画面に追加して使う場合は、ホーム画面から開いて保存してください。',
} as const;

/** index.json（ファイル一覧）はメモリに1回だけ持つ（結果を出すたびに取り直さない）。失敗は覚えない。 */
let indexMemo: Promise<ShelterIndex | null> | null = null;
export function fetchShelterIndex(d: Pick<OfflinePanelDeps, 'base' | 'fetch'>): Promise<ShelterIndex | null> {
  if (indexMemo) return indexMemo;
  const p = (async () => {
    const res = await d.fetch(`${d.base}/shelters/index.json`, { cache: 'no-cache' });
    const v: unknown = res.ok ? await res.json() : null;
    return isShelterIndex(v) ? v : null;
  })().catch(() => null);
  indexMemo = p;
  void p.then((v) => { if (!v && indexMemo === p) indexMemo = null; });
  return p;
}
/** テスト用 */
export function resetOfflineIndexMemo(): void { indexMemo = null; }

/** 呼ぶたびに新しい欄を作る（画面を描きなおすときに呼ぶ）。 */
export function renderOfflinePanel(d: OfflinePanelDeps): HTMLElement {
  const status = el('p', { class: 'offline-status', id: 'offline-status', role: 'status', 'aria-live': 'polite' });
  const progress = el('progress', { class: 'offline-progress', max: 1, value: 0, hidden: true });
  const saveBtn = el('button', { type: 'button', class: 'primary', id: 'offline-save' }, OFFLINE_TEXT.save('約3MB'));
  const delBtn = el('button', { type: 'button', class: 'secondary', id: 'offline-delete', hidden: true }, OFFLINE_TEXT.remove);
  const root = el('section', { class: 'card offline-panel', id: 'offline-panel' },
    el('h2', {}, OFFLINE_TEXT.title), status, progress, saveBtn, delBtn, el('p', { class: 'hint' }, OFFLINE_TEXT.what),
    el('p', { class: 'hint', id: 'offline-evict' }, panelAutoEligible(d) ? OFFLINE_TEXT.autoEvict : OFFLINE_TEXT.evict));
  const evictP = root.querySelector('#offline-evict')!;

  let index: ShelterIndex | null = null;
  let busy = false;
  /** 途中で止まったときの文（電波の変化で描きなおしても残す） */
  let failMsg: string | null = null;

  /** 自動保存の途中なら、その表示にする（ボタンは出さない） */
  const showAuto = (): boolean => {
    const a = autoStatus();
    if (a.phase !== 'running' || busy) return false;
    status.textContent = OFFLINE_TEXT.autoSaving;
    status.classList.remove('strong');
    progress.hidden = false;
    progress.max = Math.max(1, a.total);
    progress.value = a.done;
    saveBtn.hidden = true;
    delBtn.hidden = true;
    return true;
  };

  const refresh = async (): Promise<void> => {
    if (!d.caches) { status.textContent = OFFLINE_TEXT.unsupported; saveBtn.disabled = true; return; }
    evictP.textContent = panelAutoEligible(d) ? OFFLINE_TEXT.autoEvict : OFFLINE_TEXT.evict;
    if (showAuto()) return;
    if (!busy) progress.hidden = true;
    const have = await savedIndex(d.caches, d.base);
    let saved = loadSheltersSaved(d.store);
    if (!have) saved = null; // 端末のキャッシュが消されていたら「保存していない」
    if (have && !saved) saved = { savedAt: '', updated: have.updated, count: have.count };
    const newer = hasNewerData(saved, index);
    if (index) saveBtn.textContent = saved ? OFFLINE_TEXT.resave : OFFLINE_TEXT.save(sizeText(index.bytes));
    delBtn.hidden = !have;
    saveBtn.hidden = !!saved && !newer;
    if (saved) {
      const date = saved.savedAt ? savedDateText(saved.savedAt) : '日付不明';
      const line = saved.auto ? OFFLINE_TEXT.autoSaved(date, saved.count) : OFFLINE_TEXT.saved(date, saved.count);
      status.textContent = newer ? `${line} ${OFFLINE_TEXT.newer}` : line;
      status.classList.toggle('strong', newer);
    } else {
      status.textContent = failMsg ?? `${OFFLINE_TEXT.notSaved}${d.online() ? '' : OFFLINE_TEXT.offline}`;
      status.classList.remove('strong');
    }
    saveBtn.disabled = busy || !d.online();
  };

  const loadIndex = async (): Promise<void> => {
    if (!d.online()) return;
    index = await fetchShelterIndex(d);
  };

  saveBtn.addEventListener('click', () => void (async () => {
    const caches = d.caches;
    if (busy || !caches) return;
    busy = true;
    saveBtn.disabled = true;
    delBtn.disabled = true;
    let done = 0, total = 0;
    try {
      if (!index) await loadIndex();
      const idx = index;
      if (!idx || idx.files.length === 0) { status.textContent = OFFLINE_TEXT.noIndex; return; }
      // 手動で保存し直したら、自動保存の停止を解除する
      setAutoOff(d.store, false);
      progress.hidden = false;
      status.textContent = OFFLINE_TEXT.saving(0, idx.files.length);
      // 自動保存・ほかのタブの保存や削除が終わるのを待ってから（同じロック）
      await withSaveLock(async () => {
        // しばらく開かないと消されることがあるので、消さないよう頼む（できなくても保存は続ける）
        try { await navigator.storage?.persist?.(); } catch { /* 何もしない */ }
        // 保存済みの印は、全部そろったときにだけ付け直す
        clearSheltersSaved(d.store);
        await saveShelters({
          base: d.base, index: idx, caches, fetch: d.fetch,
          onProgress: (a, b) => { done = a; total = b; progress.max = Math.max(1, b); progress.value = a; status.textContent = OFFLINE_TEXT.saving(a, b); },
        });
        writeSheltersSaved(d.store, { savedAt: today(), updated: idx.updated, count: idx.count });
        clearAutoPending(d.store);
      }, { wait: true, locks: d.locks });
      failMsg = null;
      await refresh();
      status.textContent = `${status.textContent} ${OFFLINE_TEXT.done}`;
    } catch {
      failMsg = OFFLINE_TEXT.failed(done, total || index?.files.length || 0);
      status.textContent = failMsg;
      saveBtn.hidden = false;
      saveBtn.textContent = d.store && loadSheltersSaved(d.store) ? OFFLINE_TEXT.resave : OFFLINE_TEXT.save(sizeText(index?.bytes ?? 0));
    } finally {
      busy = false;
      progress.hidden = true;
      saveBtn.disabled = !d.online();
      delBtn.disabled = false;
    }
  })());

  delBtn.addEventListener('click', () => void (async () => {
    const caches = d.caches;
    if (busy || !caches) return;
    busy = true;
    saveBtn.disabled = true;
    delBtn.disabled = true;
    // 消したら自動で保存し直さない（自動保存の途中なら止める。ほかのタブも storage イベントで止まる）
    stopAutoSave(d.store);
    let ok = true;
    try {
      const r = await withSaveLock(async () => {
        await deleteSavedShelters(caches, d.store);
        clearAutoPending(d.store);
      }, { wait: true, locks: d.locks });
      ok = r !== SKIPPED;
    } catch {
      ok = false;
    } finally {
      busy = false;
      delBtn.disabled = false;
    }
    failMsg = null;
    await refresh();
    if (ok) status.textContent = `${OFFLINE_TEXT.removed} ${status.textContent}`;
  })());

  // 電波が戻った・切れたらボタンの状態を変える（画面から外れたら聞くのをやめる）
  let offAuto: (() => void) | null = null;
  const onNet = (): void => {
    if (!root.isConnected) { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); offAuto?.(); return; }
    if (busy) return;
    void (async () => { if (!index) await loadIndex(); await refresh(); })();
  };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  // 自動保存の進み具合・終わったら描きなおす（画面から外れたら聞くのをやめる）
  let wasRunning = autoStatus().phase === 'running';
  offAuto = onAutoStatus(() => {
    if (!root.isConnected) { onNet(); return; }
    if (busy) return;
    const running = autoStatus().phase === 'running';
    if (running) showAuto();
    else if (wasRunning) void refresh();
    wasRunning = running;
  });
  void (async () => { await loadIndex(); await refresh(); })();
  return root;
}
