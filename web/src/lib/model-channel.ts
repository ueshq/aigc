export const modelChannelProtocols = [
    { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", baseUrlPresets: [{ label: "OpenAI", value: "https://api.openai.com" }, { label: "RunningHub LLM", value: "https://llm.runninghub.ai/v1" }] },
    { value: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com" },
    { value: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io", apiKeyUrl: "https://platform.minimax.io", baseUrlPresets: [{ label: "国际站", value: "https://api.minimax.io" }, { label: "国内站", value: "https://api.minimax.cn" }] },
    { value: "ark", label: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    { value: "mimo", label: "MiMo", baseUrl: "https://api.xiaomimimo.com", apiKeyUrl: "https://platform.xiaomimimo.com/?ref=JFZQR2" },
    { value: "runninghub", label: "RunningHub", baseUrl: "https://www.runninghub.ai/openapi/v2", apiKeyUrl: "https://www.runninghub.ai/enterprise-api/consumerApi", baseUrlPresets: [{ label: "国际站", value: "https://www.runninghub.ai/openapi/v2" }, { label: "国内站", value: "https://www.runninghub.cn/openapi/v2" }] },
] as const;

export type ModelChannelProtocol = (typeof modelChannelProtocols)[number]["value"];
export const modelChannelProtocolOptions = modelChannelProtocols.map(({ value, label }) => ({ label, value }));
export const modelChannelDefaultBaseUrls = Object.fromEntries(modelChannelProtocols.map(({ value, baseUrl }) => [value, baseUrl])) as Record<ModelChannelProtocol, string>;
export const modelChannelApiKeyUrls = Object.fromEntries(modelChannelProtocols.flatMap((protocol) => "apiKeyUrl" in protocol ? [[protocol.value, protocol.apiKeyUrl]] : [])) as Partial<Record<ModelChannelProtocol, string>>;
/** Official regional endpoints that share one protocol, offered as Base URL shortcuts. */
export const modelChannelBaseUrlPresets = Object.fromEntries(modelChannelProtocols.flatMap((protocol) => "baseUrlPresets" in protocol ? [[protocol.value, protocol.baseUrlPresets]] : [])) as Partial<Record<ModelChannelProtocol, readonly { label: string; value: string }[]>>;
