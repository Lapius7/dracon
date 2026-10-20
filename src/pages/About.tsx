import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TIPS = [
  ["ファイルを掴む", "エクスプローラーやデスクトップのファイルを押したままにします。"],
  ["Alt を押す", "その場に円形のメニューが開きます（キーは設定で変更できます）。"],
  ["方向へ動かして離す", "楔の方向にドラッグして離すと、その形式に変換します。"],
  ["キャンセル", "中央か外側で離すか、Esc を押します。"],
];

export default function About() {
  const [version, setVersion] = useState("");
  useEffect(() => void invoke<{ version: string }>("app_info").then((i) => setVersion(i.version)), []);
  const [upd, setUpd] = useState("");
  const [busy, setBusy] = useState(false);
  const update = async () => {
    setBusy(true);
    try {
      setUpd("確認中…");
      const u = await check();
      if (!u) return setUpd("最新版です。");
      setUpd(`v${u.version} をダウンロード中…`);
      await u.downloadAndInstall();
      setUpd("更新しました。再起動します…");
      await relaunch();
    } catch {
      setUpd("更新を確認できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex items-center gap-5 pt-2">
        <img src="/dracon.svg" alt="" className="size-20" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dracon</h1>
          <p className="mt-1 text-sm text-muted-foreground">ドラッグで変換する、ファイルコンバーター　{version && <span className="tnum">v{version}</span>}</p>
        </div>
      </div>
      <Card>
        <CardContent>
          <h2 className="mb-4 text-sm font-semibold">使い方</h2>
          <ol className="flex flex-col gap-4">
            {TIPS.map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
                <div>
                  <div className="text-sm font-medium">{t}</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={update}>アップデートを確認</Button>
        {upd && <span className="text-xs text-muted-foreground">{upd}</span>}
      </div>
      <p className="text-xs text-muted-foreground">変換はすべてこの PC の中で行われ、ファイルが外部に送信されることはありません。</p>
    </>
  );
}
