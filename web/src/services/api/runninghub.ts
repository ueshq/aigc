import axios from "axios";

import { aiApiUrl, aiHeaders } from "./ai-request";
import { RUNNINGHUB_LYRICS_MODEL, type RunningHubParamValue } from "@/lib/runninghub";
import { channelIdForActiveModel, type AiConfig } from "@/stores/use-config-store";

type RunningHubMediaPart = "image_url" | "video_url" | "audio_url" | "first_frame_url" | "last_frame_url";
export type RunningHubChatPart = { type: "text"; text: string } | ({ type: RunningHubMediaPart } & Partial<Record<RunningHubMediaPart, { url: string }>>);

export function runningHubChatPart(type: RunningHubMediaPart, url: string) {
    return { type, [type]: { url } } as RunningHubChatPart;
}

/** Runs a RunningHub text family (prompt optimization, lyrics, captions) on the caller's RunningHub channel via the chat proxy. */
export async function requestRunningHubText(config: AiConfig, model: string, content: string | RunningHubChatPart[], extraParams?: Record<string, RunningHubParamValue>) {
    const channelId = channelIdForActiveModel(config);
    const textConfig: AiConfig = { ...config, model, textModel: model, textChannelId: channelId, activeChannelId: channelId };
    try {
        const { data } = await axios.post<{ code?: number; msg?: string; choices?: Array<{ message?: { content?: string } }> }>(aiApiUrl(textConfig, "/chat/completions"), { model, messages: [{ role: "user", content }], ...(extraParams ? { extra_params: extraParams } : {}) }, { headers: aiHeaders(textConfig, "application/json") });
        if (typeof data.code === "number" && data.code !== 0) throw new Error(data.msg || "RunningHub 请求失败");
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("RunningHub 没有返回内容");
        return text;
    } catch (error) {
        if (axios.isAxiosError<{ msg?: string }>(error)) throw new Error(error.response?.data?.msg || error.message);
        throw error;
    }
}

export function generateRunningHubLyrics(config: AiConfig, topic: string) {
    return requestRunningHubText(config, RUNNINGHUB_LYRICS_MODEL, topic);
}
