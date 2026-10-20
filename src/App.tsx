import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeftRight, Info, Settings as Cog } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import Convert from "@/pages/Convert";
import SettingsPage from "@/pages/SettingsPage";
import About from "@/pages/About";

type Page = "convert" | "settings" | "about";
const NAV: { id: Page; label: string; icon: typeof Cog }[] = [
  { id: "convert", label: "変換", icon: ArrowLeftRight },
  { id: "settings", label: "設定", icon: Cog },
  { id: "about", label: "情報", icon: Info },
];

const fromHash = (): Page => {
  const h = location.hash.replace("#", "");
  return h === "settings" || h === "about" ? h : "convert";
};

export default function App() {
  const [page, setPage] = useState<Page>(fromHash);
  const [cfg] = useSettings();
  const key = ({ alt: "Alt", ctrl: "Ctrl", shift: "Shift", none: "" } as const)[cfg?.trigger ?? "alt"];
  useEffect(() => {
    const un = listen<string>("dracon://navigate", (e) => setPage(e.payload as Page));
    return () => void un.then((f) => f());
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
          <div className="mb-3 flex items-center gap-2.5 px-2 pt-1">
            <img src="/dracon.svg" alt="" className="size-8" />
            <span className="text-[15px] font-semibold tracking-tight">Dracon</span>
          </div>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-secondary hover:text-foreground",
                page === id && "bg-secondary font-medium text-foreground shadow-[inset_2px_0_0_var(--color-accent)]",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </button>
          ))}
          <p className="mt-auto px-3 pb-1 text-xs leading-relaxed text-muted-foreground">
            {cfg && !cfg.wheel_enabled ? (
              "ホイールはオフです"
            ) : key ? (
              <>
                ファイルを掴んで
                <br />
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px]">{key}</kbd> でホイール
              </>
            ) : (
              <>
                ファイルを掴むと
                <br />
                ホイールが出ます
              </>
            )}
          </p>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div key={page} className="page-in mx-auto flex min-h-full max-w-2xl flex-col gap-5 p-7">
            {page === "convert" && <Convert />}
            {page === "settings" && <SettingsPage />}
            {page === "about" && <About />}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
