export const modelChannelProtocols = [
    { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com" },
    { value: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com" },
    { value: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io", apiKeyUrl: "https://platform.minimax.io" },
    { value: "ark", label: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    { value: "mimo", label: "MiMo", baseUrl: "https://api.xiaomimimo.com", apiKeyUrl: "https://platform.xiaomimimo.com/?ref=JFZQR2" },
] as const;

export type ModelChannelProtocol = (typeof modelChannelProtocols)[number]["value"];
export const modelChannelProtocolOptions = modelChannelProtocols.map(({ value, label }) => ({ label, value }));
export const modelChannelDefaultBaseUrls = Object.fromEntries(modelChannelProtocols.map(({ value, baseUrl }) => [value, baseUrl])) as Record<ModelChannelProtocol, string>;
export const modelChannelApiKeyUrls = Object.fromEntries(modelChannelProtocols.flatMap((protocol) => "apiKeyUrl" in protocol ? [[protocol.value, protocol.apiKeyUrl]] : [])) as Partial<Record<ModelChannelProtocol, string>>;
