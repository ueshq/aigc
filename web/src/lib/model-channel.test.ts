import assert from "node:assert/strict";
import test from "node:test";
import { modelChannelApiKeyUrls, modelChannelBaseUrlPresets, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "./model-channel";

test("built-in protocol options are shared by both settings panels", () => {
    assert.deepEqual(modelChannelProtocolOptions, [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "MiniMax", value: "minimax" },
        { label: "火山方舟", value: "ark" },
        { label: "MiMo", value: "mimo" },
        { label: "RunningHub", value: "runninghub" },
    ]);
});

test("built-in protocols use official default URLs and API Key links", () => {
    assert.deepEqual(modelChannelDefaultBaseUrls, {
        openai: "https://api.openai.com",
        gemini: "https://generativelanguage.googleapis.com",
        minimax: "https://api.minimax.io",
        ark: "https://ark.cn-beijing.volces.com/api/v3",
        mimo: "https://api.xiaomimimo.com",
        runninghub: "https://www.runninghub.ai/openapi/v2",
    });
    assert.deepEqual(modelChannelApiKeyUrls, {
        minimax: "https://platform.minimax.io",
        mimo: "https://platform.xiaomimimo.com/?ref=JFZQR2",
        runninghub: "https://www.runninghub.ai/enterprise-api/consumerApi",
    });
    assert.deepEqual(modelChannelBaseUrlPresets, {
        openai: [{ label: "OpenAI", value: "https://api.openai.com" }, { label: "RunningHub LLM", value: "https://llm.runninghub.ai/v1" }],
        minimax: [{ label: "国际站", value: "https://api.minimax.io" }, { label: "国内站", value: "https://api.minimax.cn" }],
        runninghub: [{ label: "国际站", value: "https://www.runninghub.ai/openapi/v2" }, { label: "国内站", value: "https://www.runninghub.cn/openapi/v2" }],
    });
});
