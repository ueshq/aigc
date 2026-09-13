"use client";

import { buildGenerationConfig, videoConfigPatch } from "./canvas-node-generation";

import { useEffect, useState } from "react";
import { ArrowUp, BookOpen, LoaderCircle, Maximize2, WandSparkles } from "lucide-react";
import { App, Button, Modal, Segmented, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { isMiniMaxH3BaseModel, isMiniMaxH3Config } from "@/lib/minimax-video";
import { isRunningHubConfig, runningHubPromptOptional, RUNNINGHUB_PROMPT_OPTIMIZE_MODEL } from "@/lib/runninghub";
import { CanvasRunningHubParamsPopover } from "./canvas-runninghub-params-popover";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasCameraControl } from "./canvas-camera-control";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { CanvasVideoSettingsPopover, type CanvasVideoFrameOption, type CanvasVideoResourceOption } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import { isCanvasImageNodeType, isPanoramaNodeType } from "../utils/canvas-panorama";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    videoFrameOptions?: CanvasVideoFrameOption[];
    videoResourceOptions?: CanvasVideoResourceOption[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    onOptimizePrompt?: (nodeId: string, prompt: string) => Promise<string>;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], connectedNodes = [], videoFrameOptions = [], videoResourceOptions = [], onDisconnectReference, onStartReferenceSelection, onImageSettingsOpenChange, onOptimizePrompt }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type, node.metadata?.generationMode);
    const config = buildGenerationConfig(globalConfig, node, mode);
    const isPanorama = isPanoramaNodeType(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isCanvasImageNodeType(node.type) && Boolean(node.metadata?.content);
    const sourcePrompt = isPanorama ? node.metadata?.panoramaSourcePrompt || "" : node.metadata?.prompt || "";
    const [prompt, setPrompt] = useState(sourcePrompt);
    const [expanded, setExpanded] = useState(false);
    const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
    const [optimizingPrompt, setOptimizingPrompt] = useState(false);
    const { message, modal } = App.useApp();
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? config.count : 1 });

    useEffect(() => {
        setPrompt(sourcePrompt);
    }, [node.id, sourcePrompt]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
    };

    const canSubmit = Boolean(prompt.trim()) || (isPanorama && (hasImageContent || mentionReferences.length > 0)) || runningHubPromptOptional(config, config.model);

    const submit = () => {
        const text = prompt.trim();
        if (!canSubmit || isRunning) return;
        onGenerate(node.id, mode, text);
        if (!isPanorama) setPrompt("");
    };

    const canOptimizePrompt = mode === "video" && Boolean(onOptimizePrompt) && ((isMiniMaxH3BaseModel(config.model) && isMiniMaxH3Config(config, config.model)) || (config.model === RUNNINGHUB_PROMPT_OPTIMIZE_MODEL && isRunningHubConfig(config, config.model)));
    const canSwitchTo3d = isCanvasImageNodeType(node.type) && !isPanorama;
    const optimizePrompt = async () => {
        if (!onOptimizePrompt || !prompt.trim() || optimizingPrompt) return;
        setOptimizingPrompt(true);
        try {
            const optimized = await onOptimizePrompt(node.id, prompt);
            modal.confirm({ title: "AI 优化提示词", icon: null, width: 720, okText: "替换提示词", cancelText: "保留原提示词", content: <div className="thin-scrollbar max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm">{optimized}</div>, onOk: () => updatePrompt(optimized) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词优化失败");
        } finally {
            setOptimizingPrompt(false);
        }
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar nodeId={node.id} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} />
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={isPanorama ? "描述想生成的全景，或上传/连接图片作为参考" : promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title="放大编辑">
                        <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={() => setExpanded(true)} aria-label="放大编辑" />
                    </Tooltip>
                    <Tooltip title="提示词库">
                        <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<BookOpen className="size-3.5" />} onClick={() => setPromptLibraryOpen(true)} aria-label="提示词库" />
                    </Tooltip>
                    {canOptimizePrompt ? (
                        <Tooltip title="AI 优化提示词">
                            <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={optimizingPrompt ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />} disabled={optimizingPrompt || !prompt.trim()} onClick={() => void optimizePrompt()} aria-label="AI 优化提示词" />
                        </Tooltip>
                    ) : null}
                    <PromptSelectDialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen} onSelect={updatePrompt} />
                    {canSwitchTo3d ? <Segmented size="small" className="shrink-0" value={mode} options={[{ value: "image", label: "图片" }, { value: "model3d", label: "3D" }]} onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode, ...(/\/model3d$/.test(node.metadata?.model || "") ? { model: undefined, channelId: undefined } : {}) })} /> : null}
                    {mode === "model3d" ? (
                        <>
                            <ModelPicker className="!w-[180px] !min-w-0 !shrink-0" config={config} value={config.model} channelId={config.model3dChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="model3d" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasRunningHubParamsPopover config={config} buttonClassName="!h-10 !shrink-0 !rounded-full !px-3" onChange={(runningHubParams) => onConfigChange(node.id, { runningHubParams })} />
                        </>
                    ) : mode === "image" ? (
                        <>
                            <ModelPicker className="!w-[180px] !min-w-0 !shrink-0" config={config} value={config.model} channelId={config.imageChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !w-[148px] !shrink-0 !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                                showSize={!isPanorama}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker className="!w-[180px] !min-w-0 !shrink-0" config={config} value={config.model} channelId={config.videoChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !w-[148px] !shrink-0 !justify-start !rounded-full !px-3" hasReferenceMedia={videoResourceOptions.some((item) => item.kind !== "text")} frameOptions={videoFrameOptions} firstFrameNodeId={node.metadata?.firstFrameNodeId} lastFrameNodeId={node.metadata?.lastFrameNodeId} onFrameChange={(patch) => onConfigChange(node.id, patch)} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker className="!w-[180px] !min-w-0 !shrink-0" config={config} value={config.model} channelId={config.audioChannelId || config.activeChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} resourceOptions={videoResourceOptions} metadata={node.metadata} onMetadataChange={(patch) => onConfigChange(node.id, patch)} buttonClassName="!h-10 !w-[148px] !shrink-0 !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, { [key]: value })} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} channelId={config.textChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                    {mode === "video" || (mode === "image" && !isPanorama) ? (
                        <CanvasCameraControl value={node.metadata?.cameraControl} onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })} buttonClassName="!h-10 !min-w-[92px] !justify-start !rounded-full !px-3" />
                    ) : null}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    disabled={isRunning || !canSubmit}
                    onClick={submit}
                    aria-label="生成"
                >
                    <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                            <CreditSymbol />
                            {credits.toLocaleString()}
                        </span>
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>
            <Modal title="编辑提示词" open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-2xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={isPanorama ? "描述想生成的全景，或上传/连接图片作为参考" : promptPlaceholder(mode, hasImageContent, hasTextContent)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"], generationMode?: CanvasGenerationMode): CanvasGenerationMode {
    if (type === CanvasNodeType.Model3D || (type === CanvasNodeType.Image && generationMode === "model3d")) return "model3d";
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function promptPlaceholder(mode: CanvasGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "model3d") return hasImageContent ? "描述要生成的 3D 模型，可留空直接用图片生成" : "描述要生成的 3D 模型";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}
