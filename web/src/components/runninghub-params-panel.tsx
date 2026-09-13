"use client";

import { useState } from "react";
import { Button, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import { Info, WandSparkles } from "lucide-react";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { runningHubModelInfo, runningHubParamValues, setRunningHubParamValues, type RunningHubParam, type RunningHubParamValue } from "@/lib/runninghub";

type RunningHubParamsPanelProps = {
    model: string;
    /** Reference mode of the request; parameters used only by other modes are hidden. */
    mode?: string;
    /** JSON store of advanced parameters per family (AiConfig.runningHubParams). */
    value?: string;
    onChange: (value: string) => void;
    theme: CanvasTheme;
    onGenerateLyrics?: (topic: string) => Promise<string>;
};

const textAreaKeys = new Set(["lyrics", "previewText", "negativePrompt", "texturePrompt", "instructions"]);

/** Schema-driven form for RunningHub parameters that the regular settings do not cover. */
export function RunningHubParamsPanel({ model, mode, value, onChange, theme, onGenerateLyrics }: RunningHubParamsPanelProps) {
    const [lyricsLoading, setLyricsLoading] = useState(false);
    const [lyricsError, setLyricsError] = useState("");
    const params = (runningHubModelInfo(model)?.params || []).filter((param) => !mode || !param.modes || param.modes.includes(mode));
    if (!params.length) return null;
    const values = runningHubParamValues(value, model);
    const update = (key: string, next: RunningHubParamValue | undefined) => onChange(setRunningHubParamValues(value, model, { ...values, [key]: next }));
    const generateLyrics = async () => {
        const topic = String(values.lyrics || "").trim();
        if (!topic || !onGenerateLyrics) {
            setLyricsError("请先在歌词框里写下歌曲主题");
            return;
        }
        setLyricsLoading(true);
        setLyricsError("");
        try {
            update("lyrics", await onGenerateLyrics(topic));
        } catch (error) {
            setLyricsError(error instanceof Error ? error.message : "歌词生成失败");
        } finally {
            setLyricsLoading(false);
        }
    };

    return (
        <div className="space-y-2.5" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                高级参数
            </div>
            {params.map((param) => (
                <div key={param.key} className="grid gap-1">
                    <div className="flex min-w-0 items-center gap-1 text-xs" style={{ color: theme.node.text }}>
                        <span className="truncate">{param.label}</span>
                        {param.required ? <span className="text-red-500">*</span> : null}
                        {param.description ? (
                            <Tooltip title={param.description}>
                                <Info className="size-3 shrink-0 opacity-50" />
                            </Tooltip>
                        ) : null}
                        {param.key === "lyrics" && onGenerateLyrics ? (
                            <Button size="small" type="link" className="!ml-auto !h-5 !px-0 !text-xs" loading={lyricsLoading} icon={<WandSparkles className="size-3" />} onClick={() => void generateLyrics()}>
                                AI 写歌词
                            </Button>
                        ) : null}
                    </div>
                    <ParamControl param={param} value={values[param.key]} onChange={(next) => update(param.key, next)} />
                </div>
            ))}
            {lyricsError ? <div className="text-xs text-red-500">{lyricsError}</div> : null}
        </div>
    );
}

function ParamControl({ param, value, onChange }: { param: RunningHubParam; value?: RunningHubParamValue; onChange: (value: RunningHubParamValue | undefined) => void }) {
    if (param.type === "LIST") {
        const current = value ?? param.default;
        return <Select size="small" className="w-full" allowClear={!param.required} value={current === undefined ? undefined : String(current)} options={(param.options || []).map((option) => ({ value: String(option.value), label: option.label }))} onChange={(next?: string) => onChange(next)} />;
    }
    if (param.type === "BOOLEAN") return <Switch size="small" className="!w-fit" checked={Boolean(value ?? param.default)} onChange={(checked) => onChange(checked)} />;
    if (param.type === "INT" || param.type === "FLOAT") {
        const current = typeof value === "number" ? value : typeof param.default === "number" ? param.default : null;
        return <InputNumber size="small" className="!w-full" min={param.min} max={param.max} step={param.step ?? (param.type === "INT" ? 1 : 0.1)} precision={param.type === "INT" ? 0 : undefined} value={current} onChange={(next) => onChange(next ?? undefined)} />;
    }
    const text = typeof value === "string" ? value : "";
    if (textAreaKeys.has(param.key) || (param.placeholder?.length || 0) > 40) return <Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 8 }} placeholder={param.placeholder} value={text} onChange={(event) => onChange(event.target.value)} />;
    return <Input size="small" placeholder={param.placeholder} value={text} onChange={(event) => onChange(event.target.value)} />;
}
