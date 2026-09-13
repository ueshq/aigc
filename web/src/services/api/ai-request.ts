import { buildApiUrl, channelIdForActiveModel, channelProtocolForConfig, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function usesAccountProxy(config: AiConfig) {
    return config.channelMode === "remote" || Boolean(useUserStore.getState().token);
}

export function aiApiUrl(config: AiConfig, path: string) {
    if (usesAccountProxy(config)) return `/api/v1${path}`;
    if (channelProtocolForConfig(config) === "runninghub") throw new Error("RunningHub 渠道需要登录后通过后端代理使用");
    return buildApiUrl(localChannelForActiveModel(config)?.baseUrl || config.baseUrl, path);
}

export function aiHeaders(config: AiConfig, contentType?: string): Record<string, string> {
    const token = useUserStore.getState().token;
    if (config.channelMode === "remote" && !token) throw new Error("请先登录后再使用云端渠道");
    const headers: Record<string, string> = contentType ? { "Content-Type": contentType } : {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
        const channelId = channelIdForActiveModel(config);
        if (channelId) headers[config.channelMode === "remote" ? "X-Model-Channel-ID" : "X-User-Model-Channel-ID"] = channelId;
    } else {
        const key = localChannelForActiveModel(config)?.apiKey || config.apiKey;
        if (channelProtocolForConfig(config) === "gemini") headers["x-goog-api-key"] = key;
        else headers.Authorization = `Bearer ${key}`;
    }
    return headers;
}

export function refreshRemoteUser(config: AiConfig) {
    if (usesAccountProxy(config)) void useUserStore.getState().hydrateUser();
}

export function formatErrorDetail(detail: unknown) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;
    try {
        return JSON.stringify(detail, null, 2);
    } catch {
        return String(detail);
    }
}

export function publicHttpUrl(value?: string) {
    if (!value || value.startsWith("blob:") || value.startsWith("data:")) return "";
    try {
        const url = new URL(value, typeof window === "undefined" ? undefined : window.location.origin);
        if (!["http:", "https:"].includes(url.protocol)) return "";
        if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return "";
        return url.href;
    } catch {
        return "";
    }
}

export function isCompletedTask(status?: string) {
    return ["completed", "complete", "done", "succeeded", "success"].includes((status || "").toLowerCase());
}

export function isFailedTask(status?: string) {
    return ["failed", "fail", "error", "cancelled", "canceled"].includes((status || "").toLowerCase());
}
