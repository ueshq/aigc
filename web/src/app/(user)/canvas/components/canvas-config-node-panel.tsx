"use client";

import { buildGenerationConfig, videoConfigPatch } from "./canvas-node-generation";

import type { CSSProperties } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Video } from "lucide-react";
import { Button, Segmented } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasCameraControl } from "./canvas-camera-control";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover, type CanvasVideoFrameOption, type CanvasVideoResourceOption } from "./canvas-video-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    videoFrameOptions?: CanvasVideoFrameOption[];
    videoResourceOptions?: CanvasVideoResourceOption[];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, videoFrameOptions = [], videoResourceOptions = [], onConfigChange, onGenerate, onComposerToggle }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildGenerationConfig(globalConfig, node, mode);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? count : 1 });
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">生成配置</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, modePatch(globalConfig, value as CanvasGenerationMode))}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        生图
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        文本
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        视频
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        音频
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label="提示词" value={`${inputSummary.textCount} 个`} style={chipStyle} />
                <InputChip label="参考图" value={`${inputSummary.imageCount} 张`} style={chipStyle} />
                <InputChip label="参考视频" value={`${inputSummary.videoCount} 个`} style={chipStyle} />
                <InputChip label="参考音频" value={`${inputSummary.audioCount} 个`} style={chipStyle} />
                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    组装提示词
                </button>
            </div>

            <div className={`mb-2 grid min-w-0 cursor-default items-center gap-2 ${mode === "image" || mode === "video" ? "grid-cols-[minmax(0,1fr)_148px_92px]" : mode === "audio" ? "grid-cols-[minmax(0,1fr)_148px]" : "grid-cols-1"}`} onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker className="canvas-compact-control h-10" config={config} value={config.model} channelId={modelChannelId(config, mode)} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                {mode === "video" ? (
                    <CanvasVideoSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" hasReferenceMedia={videoResourceOptions.some((item) => item.kind !== "text")} frameOptions={videoFrameOptions} firstFrameNodeId={node.metadata?.firstFrameNodeId} lastFrameNodeId={node.metadata?.lastFrameNodeId} onFrameChange={(patch) => onConfigChange(node.id, patch)} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover config={config} placement="topRight" autoAdjustOverflow={false} buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover config={config} resourceOptions={videoResourceOptions} metadata={node.metadata} onMetadataChange={(patch) => onConfigChange(node.id, patch)} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, { [key]: value })} />
                ) : null}
                {mode === "image" || mode === "video" ? (
                    <CanvasCameraControl value={node.metadata?.cameraControl} onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })} buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" />
                ) : null}
            </div>

            <Button
                type="primary"
                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                disabled={isRunning || !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onGenerate(node.id)}
            >
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1">
                        <CreditSymbol />
                        {credits.toLocaleString()}
                    </span>
                    {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                    <span>开始生成</span>
                </span>
            </Button>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function modelChannelId(config: AiConfig, mode: CanvasGenerationMode) {
    if (mode === "image") return config.imageChannelId;
    if (mode === "video") return config.videoChannelId;
    if (mode === "text") return config.textChannelId;
    return config.audioChannelId || config.activeChannelId;
}

function modePatch(config: AiConfig, mode: CanvasGenerationMode): Partial<CanvasNodeMetadata> {
    if (mode === "image") return { generationMode: mode, model: config.imageModel, channelId: config.imageChannelId };
    if (mode === "video") return { generationMode: mode, model: config.videoModel, channelId: config.videoChannelId };
    if (mode === "text") return { generationMode: mode, model: config.textModel, channelId: config.textChannelId };
    return { generationMode: mode, model: config.audioModel, channelId: config.audioChannelId || config.activeChannelId };
}
