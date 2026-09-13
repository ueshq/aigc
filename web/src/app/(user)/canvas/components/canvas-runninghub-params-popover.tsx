"use client";

import { Button, Popover } from "antd";
import { SlidersHorizontal } from "lucide-react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { RunningHubParamsPanel } from "@/components/runninghub-params-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { isRunningHubConfig, runningHubModelInfo } from "@/lib/runninghub";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

/** Advanced RunningHub parameters for canvas modes without their own settings popover, such as 3D generation. */
export function CanvasRunningHubParamsPopover({ config, onChange, buttonClassName }: { config: AiConfig; onChange: (value: string) => void; buttonClassName?: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!isRunningHubConfig(config) || !runningHubModelInfo(config.model)?.params?.length) return null;
    return (
        <Popover
            trigger="click"
            placement="topLeft"
            zIndex={1200}
            content={
                <ImageSettingsTheme theme={theme}>
                    <div data-canvas-no-zoom className="thin-scrollbar max-h-[60vh] w-[320px] overflow-y-auto" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                        <RunningHubParamsPanel model={config.model} value={config.runningHubParams} onChange={onChange} theme={theme} />
                    </div>
                </ImageSettingsTheme>
            }
        >
            <Button type="text" className={buttonClassName} style={{ background: theme.node.fill, color: theme.node.text }} icon={<SlidersHorizontal className="size-3.5" />} onMouseDown={(event) => event.stopPropagation()}>
                参数
            </Button>
        </Popover>
    );
}
