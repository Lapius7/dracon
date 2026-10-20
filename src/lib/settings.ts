import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Settings = {
  wheel_enabled: boolean;
  trigger: "alt" | "ctrl" | "shift" | "none";
  splash: boolean;
  autostart: boolean;
  quality: number;
  audio_bitrate: number;
  strip_metadata: boolean;
  output_dir: string | null;
  notify_done: boolean;
  wheel_image: string[];
  wheel_audio: string[];
  wheel_video: string[];
  input_exts: string[];
  wheel_scale: number;
  wheel_rotation: number;
  wheel_labels: boolean;
  wheel_thumb: boolean;
};

/** 設定を読み込み、変更したらすぐ保存する（他ウィンドウ・トレイの変更も反映） */
export function useSettings() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void invoke<Settings>("get_settings").then(setS);
    const un = listen<Settings>("dracon://settings", (e) => setS(e.payload));
    return () => void un.then((f) => f());
  }, []);
  const update = useCallback(
    (patch: Partial<Settings>) => {
      setS((cur) => {
        if (!cur) return cur;
        const next = { ...cur, ...patch };
        void invoke("set_settings", { value: next });
        return next;
      });
    },
    [],
  );
  return [s, update] as const;
}
