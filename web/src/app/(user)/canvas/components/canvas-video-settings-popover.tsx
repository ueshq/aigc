"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Settings2, Video as VideoIcon, X } from "lucide-react";
import { Button } from "antd";

import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { normalizeVideoConfig, supportsVideoFrameReferences } from "@/lib/video-model-capabilities";
import { useThemeStore } from "@/stores/use-theme-store";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";
import { isMiniMaxH3Config } from "@/lib/minimax-video";

export type CanvasVideoFrameOption = { nodeId: string; label: string; previewUrl?: string };
export type CanvasVideoResourceOption = { nodeId: string; kind: "text" | "image" | "video" | "audio"; label: string; previewUrl?: string; text?: string };

type CanvasVideoSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "runningHubParams", value: string) => void;
    frameOptions?: CanvasVideoFrameOption[];
    hasReferenceMedia?: boolean;
    firstFrameNodeId?: string;
    lastFrameNodeId?: string;
    onFrameChange?: (patch: { firstFrameNodeId?: string; lastFrameNodeId?: string }) => void;
    buttonClassName?: string;
    buttonIcon?: ReactNode;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    visualOnly?: boolean;
};

export function CanvasVideoSettingsPopover({ config, onConfigChange, frameOptions = [], hasReferenceMedia = false, firstFrameNodeId, lastFrameNodeId, onFrameChange, buttonClassName, buttonIcon, placement = "topLeft", visualOnly = false }: CanvasVideoSettingsPopoverProps) {
    const referenceMode = frameOptions.some((item) => item.nodeId === firstFrameNodeId || item.nodeId === lastFrameNodeId) ? "frames" : hasReferenceMedia ? "reference" : "text";
    config = normalizeVideoConfig(config, referenceMode);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (target instanceof Element && target.closest(".ant-select-dropdown")) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <VideoSettingsPortal referenceMode={referenceMode} buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} frameOptions={frameOptions} firstFrameNodeId={firstFrameNodeId} lastFrameNodeId={lastFrameNodeId} onFrameChange={onFrameChange} visualOnly={visualOnly} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"} style={{ background: theme.node.fill, color: theme.node.text }} icon={buttonIcon || <Settings2 className="size-3.5" />} onClick={() => setOpen((current) => !current)}>
                    <span className="truncate">
                        {videoResolutionLabel(config.vquality)} · {videoSizeLabel(config.size)}
                        {visualOnly ? null : <> · {videoSecondsLabel(config.videoSeconds)}</>}
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function VideoSettingsPortal({ referenceMode, buttonRect, panelRef, placement, theme, config, onConfigChange, frameOptions, firstFrameNodeId, lastFrameNodeId, onFrameChange, visualOnly }: { referenceMode: "text" | "frames" | "reference"; buttonRect: DOMRect; panelRef: RefObject<HTMLDivElement | null>; placement: CanvasVideoSettingsPopoverProps["placement"]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; config: AiConfig; onConfigChange: CanvasVideoSettingsPopoverProps["onConfigChange"]; frameOptions: CanvasVideoFrameOption[]; firstFrameNodeId?: string; lastFrameNodeId?: string; onFrameChange?: CanvasVideoSettingsPopoverProps["onFrameChange"]; visualOnly: boolean }) {
    const width = 356;
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = { position: "fixed", zIndex: 1200, width, left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)), ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }), background: theme.toolbar.panel, borderRadius: 18, boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)", padding: 18, overflowY: "auto", color: theme.node.text } as const;
    const model = config.model || config.videoModel || "";
    const frameReferencesEnabled = supportsVideoFrameReferences(model, channelProtocolForConfig({ ...config, model }));
    const optionIds = useMemo(() => new Set(frameOptions.map((item) => item.nodeId)), [frameOptions]);
    const firstFrameValue = firstFrameNodeId && optionIds.has(firstFrameNodeId) ? firstFrameNodeId : "";
    const lastFrameValue = lastFrameNodeId && optionIds.has(lastFrameNodeId) ? lastFrameNodeId : "";

    return createPortal(
        <div ref={panelRef} className="canvas-image-settings-popover" style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="space-y-4">
                <div className="text-lg font-semibold">视频设置</div>
                {!visualOnly && frameReferencesEnabled ? (
                    <CanvasSettingGroup title="首尾帧" color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            <FrameReferencePicker label="首帧" value={firstFrameValue} options={frameOptions} theme={theme} onChange={(value) => onFrameChange?.({ firstFrameNodeId: value || undefined })} />
                            <FrameReferencePicker label="尾帧" value={lastFrameValue} options={isMiniMaxH3Config(config, model) && !firstFrameValue ? [] : frameOptions} theme={theme} onChange={(value) => onFrameChange?.({ lastFrameNodeId: value || undefined })} />
                        </div>
                    </CanvasSettingGroup>
                ) : null}
                <VideoSettingsPanel config={config} modelName={visualOnly ? config.videoModel || config.model : undefined} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showTitle={false} className="space-y-4" referenceMode={referenceMode} visualOnly={visualOnly} />
            </div>
        </div>,
        document.body,
    );
}

function FrameReferencePicker({ label, value, options, theme, onChange }: { label: string; value: string; options: CanvasVideoFrameOption[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const selected = options.find((item) => item.nodeId === value);
    const items = [{ nodeId: "", label: "不指定" }, ...options];
    return <div className="relative grid gap-1.5 text-xs" style={{ color: theme.node.muted }}><div>{label}</div><button type="button" className="flex h-12 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border px-2 text-left transition hover:opacity-90" style={{ background: theme.node.fill, borderColor: open ? theme.toolbar.activeText : theme.node.stroke, color: theme.node.text }} onClick={() => setOpen((current) => !current)}><FramePreview option={selected} /><span className="min-w-0 flex-1 overflow-hidden"><span className="block truncate font-medium">{selected?.label || "不指定"}</span><span className="block truncate opacity-55">{selected ? "已连接图片节点" : options.length ? "点击选择已连接图片" : "暂无已连接图片"}</span></span>{selected ? <ClearButton onClick={() => onChange("")} /> : null}</button>{open ? <PickerMenu items={items} value={value} theme={theme} renderPreview={(item) => <FramePreview option={item.nodeId ? item : undefined} />} renderTitle={(item) => item.label} renderSubtitle={(item) => (item.nodeId ? "已连接图片节点" : "不使用首尾帧图片")} onSelect={(nodeId) => { onChange(nodeId); setOpen(false); }} /> : null}</div>;
}

export function ResourceSinglePicker({ label, value, options, placeholder, emptyText, theme, onChange }: { label?: string; value: string; options: CanvasVideoResourceOption[]; placeholder: string; emptyText: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const selected = options.find((item) => item.nodeId === value);
    const items = [{ nodeId: "", kind: "text" as const, label: placeholder }, ...options];
    return <div className="relative grid gap-1.5 text-xs" style={{ color: theme.node.muted }}>{label ? <div>{label}</div> : null}<button type="button" className="flex h-14 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border px-2 text-left transition hover:opacity-90" style={{ background: theme.node.fill, borderColor: open ? theme.toolbar.activeText : theme.node.stroke, color: theme.node.text }} onClick={() => setOpen((current) => !current)}><ResourcePreview option={selected} theme={theme} /><span className="min-w-0 flex-1 overflow-hidden"><span className="block truncate font-medium">{selected ? optionTitle(selected) : placeholder}</span><span className="block truncate opacity-55">{selected ? optionSubtitle(selected) : emptyText}</span></span>{selected ? <ClearButton onClick={() => onChange("")} /> : null}</button>{open ? <PickerMenu items={items} value={value} theme={theme} renderPreview={(item) => <ResourcePreview option={item.nodeId ? item : undefined} theme={theme} />} renderTitle={(item) => (item.nodeId ? optionTitle(item) : placeholder)} renderSubtitle={(item) => (item.nodeId ? optionSubtitle(item) : emptyText)} onSelect={(nodeId) => { onChange(nodeId); setOpen(false); }} /> : null}</div>;
}

function PickerMenu<T extends { nodeId: string }>({ items, value, theme, renderPreview, renderTitle, renderSubtitle, onSelect }: { items: T[]; value: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; renderPreview: (item: T) => ReactNode; renderTitle: (item: T) => ReactNode; renderSubtitle: (item: T) => ReactNode; onSelect: (nodeId: string) => void }) {
    return <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1300] max-h-56 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>{items.map((item) => { const active = item.nodeId === value; return <button key={item.nodeId || "empty"} type="button" className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition" style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.toolbar.activeText : theme.node.text }} onClick={() => onSelect(item.nodeId)}>{renderPreview(item)}<span className="min-w-0 flex-1"><span className="block truncate font-medium">{renderTitle(item)}</span><span className="block truncate opacity-65">{renderSubtitle(item)}</span></span></button>; })}</div>;
}

function FramePreview({ option }: { option?: CanvasVideoFrameOption }) {
    if (option?.previewUrl) return <img src={option.previewUrl} alt="" className="size-9 shrink-0 rounded-md object-cover" />;
    return <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10"><ImageIcon className="size-4 opacity-55" /></span>;
}

function ResourcePreview({ option, theme, small = false }: { option?: CanvasVideoResourceOption; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; small?: boolean }) {
    const size = small ? "size-5" : "size-9";
    if (option?.kind === "image" && option.previewUrl) return <img src={option.previewUrl} alt="" className={[size, "shrink-0 rounded-md object-cover"].join(" ")} />;
    if (option?.kind === "video" && option.previewUrl) return <video src={option.previewUrl} className={[size, "shrink-0 rounded-md bg-black object-cover"].join(" ")} muted preload="metadata" />;
    const Icon = option?.kind === "audio" ? Music2 : option?.kind === "video" ? VideoIcon : option?.kind === "text" ? FileText : ImageIcon;
    return <span className={["flex shrink-0 items-center justify-center rounded-md", size].join(" ")} style={{ background: theme.node.fill }}><Icon className="size-4 opacity-55" /></span>;
}

function ClearButton({ onClick }: { onClick: () => void }) {
    return <span role="button" tabIndex={0} className="rounded-full p-1 opacity-55 transition hover:opacity-100" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(); }}><X className="size-3.5" /></span>;
}

function CanvasSettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return <div className="space-y-2.5"><div className="text-xs font-medium" style={{ color }}>{title}</div>{children}</div>;
}

function optionTitle(item: CanvasVideoResourceOption) {
    if (item.kind === "text") return shortText(item.text || item.label, 10);
    return item.label;
}

function optionSubtitle(item: CanvasVideoResourceOption) {
    if (item.kind === "text") return item.text ? shortText(item.text, 24) : "文字节点";
    if (item.kind === "image") return "图片节点";
    if (item.kind === "video") return "视频节点";
    return "音频节点";
}

function shortText(value: string, max: number) {
    const text = String(value || "").trim();
    return text.length > max ? text.slice(0, max) + "..." : text;
}
