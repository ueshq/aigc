import assert from "node:assert/strict";
import test from "node:test";
import { modelChannelApiKeyUrls, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "./model-channel";

test("built-in protocol options are shared by both settings panels", () => {
    assert.deepEqual(modelChannelProtocolOptions, [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "MiniMax", value: "minimax" },
        { label: "火山方舟", value: "ark" },
        { label: "MiMo", value: "mimo" },
    ]);
});

test("built-in protocols use official default URLs and API Key links", () => {
    assert.deepEqual(modelChannelDefaultBaseUrls, {
        openai: "https://api.openai.com",
        gemini: "https://generativelanguage.googleapis.com",
        minimax: "https://api.minimax.io",
        ark: "https://ark.cn-beijing.volces.com/api/v3",
        mimo: "https://api.xiaomimimo.com",
    });
    assert.deepEqual(modelChannelApiKeyUrls, {
        minimax: "https://platform.minimax.io",
        mimo: "https://platform.xiaomimimo.com/?ref=JFZQR2",
    });
});
