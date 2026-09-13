import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { defaultConfig, type AiConfig } from "../../stores/use-config-store";
import { aiApiUrl, aiHeaders, refreshRemoteUser, isFailedTask } from "./ai-request";
import { normalizeVideoConfig, validateVideoDuration, videoDurationRule } from "../../lib/video-model-capabilities";
import { requestAudioGeneration } from "./audio";
import { requestGeneration, requestImageQuestion, ImageRequestError } from "./image";
import { requestCanvasAgentTurn } from "./canvas-agent";
import { useUserStore } from "../../stores/use-user-store";
import { createVideoGenerationTask, pollVideoGenerationTaskStatus, isCompletedVideoTask, isVideoPollDue, optimizeMiniMaxPrompt } from "./video";

function configFor(model: string, protocol: "minimax" | "openai" | "gemini" | "mimo" | "ark" = "minimax"): AiConfig {
    const channel = { id: "channel", name: "fixture", protocol, baseUrl: "https://api.minimax.io", apiKey: "test-key", models: [model] };
    return { ...defaultConfig, model, videoModel: model, videoChannelId: channel.id, localChannels: [channel], vquality: "768P", videoSeconds: "5", size: "adaptive" };
}

test("browser direct H3 requests and polling use official paths and Bearer auth", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    context.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network I/O"); });
    let createdBody: Record<string, unknown> = {};
    context.mock.method(axios, "post", async (url: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
        assert.equal(url, "https://api.minimax.io/v2/video_generation");
        assert.equal(options.headers.Authorization, "Bearer test-key");
        createdBody = body;
        return { data: { task_id: "job" } };
    });
    context.mock.method(axios, "get", async (url: string, options: { headers: Record<string, string> }) => {
        assert.equal(url, "https://api.minimax.io/v2/query/video_generation/job");
        assert.equal(options.headers.Authorization, "Bearer test-key");
        return { data: { task: { id: "job", status: "succeeded", content: { url: "https://media.example/video.mp4" }, duration: 5, ratio: "16:9", resolution: "768P" } } };
    });
    for (const model of ["MiniMax-H3", "MiniMax-H3-Max"]) {
        const config = configFor(model);
        const created = await createVideoGenerationTask(config, "场景");
        assert.deepEqual(createdBody, { model, content: [{ type: "text", text: "场景" }], resolution: "768P", duration: 5, ratio: "16:9" });
        assert.equal(created.id, "job");
        const task = await pollVideoGenerationTaskStatus(config, created);
        assert.equal(task.video_url, "https://media.example/video.mp4");
        assert.equal(task.seconds, "5");
        assert.equal(task.size, "16:9");
    }
    const frame = { id: "frame", name: "frame.png", type: "image/png", dataUrl: "https://media.example/frame.png" };
    await createVideoGenerationTask(configFor("MiniMax-H3-Max"), "scene", { firstFrame: frame, lastFrame: frame });
    assert.deepEqual(createdBody.content, [
        { type: "text", text: "scene" },
        { type: "image_url", image_url: { url: frame.dataUrl }, role: "first_frame" },
        { type: "image_url", image_url: { url: frame.dataUrl }, role: "last_frame" },
    ]);
    assert.equal(createdBody.ratio, "adaptive");
    const audio = { id: "audio", name: "ref.mp3", type: "audio/mpeg", url: "https://media.example/ref.mp3" };
    await createVideoGenerationTask(configFor("MiniMax-H3"), "scene", { audioReferences: [audio] });
    assert.deepEqual(createdBody.content, [
        { type: "text", text: "scene" },
        { type: "audio_url", audio_url: { url: audio.url }, role: "reference_audio" },
    ]);
    await assert.rejects(createVideoGenerationTask(configFor("MiniMax-H3-Max"), "scene", { audioReferences: [audio] }), /移除/);
    await createVideoGenerationTask({ ...configFor("MiniMax-H3"), videoWatermark: "true" }, "scene");
    assert.equal(createdBody.aigc_watermark, true);
});

test("query failures and missing output remain visible", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    let payload: unknown;
    context.mock.method(axios, "get", async () => ({ data: payload }));
    const config = configFor("MiniMax-H3-Max");
    for (const status of ["queued", "running", "failed", "cancelled"]) {
        payload = { task: { id: "job", status, ...(status === "failed" ? { error: { code: "1026", message: "rejected" } } : {}) } };
        const result = await pollVideoGenerationTaskStatus(config, { id: "job" });
        assert.equal(result.status, status);
        if (status === "failed") assert.equal(result.error?.message, "rejected");
    }
    payload = { task: { id: "job", status: "succeeded" } };
    await assert.rejects(pollVideoGenerationTaskStatus(config, { id: "job" }), /没有返回视频地址/);
    payload = { type: "error", error: { type: "authorized_error", message: "invalid key" } };
    await assert.rejects(pollVideoGenerationTaskStatus(config, { id: "job" }), /invalid key/);
});

test("browser direct Ark Seedance uses native task paths and content body", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    context.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network I/O"); });
    const model = "doubao-seedance-2-0-260128";
    const config = { ...configFor(model, "ark"), localChannels: [{ id: "channel", name: "fixture", protocol: "ark" as const, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "test-key", models: [model] }], size: "16:9", vquality: "4k" };
    let createdBody: Record<string, unknown> = {};
    context.mock.method(axios, "post", async (url: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
        assert.equal(url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
        assert.equal(options.headers.Authorization, "Bearer test-key");
        createdBody = body;
        return { data: { id: "cgt-job" } };
    });
    context.mock.method(axios, "get", async (url: string) => {
        assert.equal(url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-job");
        return { data: { id: "cgt-job", status: "expired" } };
    });
    const created = await createVideoGenerationTask(config, "scene");
    assert.deepEqual(createdBody, { model, content: [{ type: "text", text: "scene" }], duration: 5, ratio: "16:9", resolution: "4k", generate_audio: false, watermark: false });
    const task = await pollVideoGenerationTaskStatus(config, created);
    assert.equal(task.status, "failed");
});

test("retained OpenAI, Seedance, CogVideoX and Agnes builders stay reachable", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    context.mock.method(axios, "post", async (_url: string, body: FormData | Record<string, unknown>) => {
        const model = body instanceof FormData ? body.get("model") : body.model;
        assert.ok(model);
        if (model === "agnes-video-2.5") assert.equal((body as Record<string, unknown>).mode, "text");
        return { data: { id: "job", status: "queued" } };
    });
    for (const model of ["generic-video", "doubao-seedance-2", "cogvideox-3", "agnes-video-2.5"]) {
        const created = await createVideoGenerationTask(configFor(model, "openai"), "scene");
        assert.equal(created.id, "job");
    }
});

test("shared transport selects channel credentials and account headers without setting multipart content type", (context) => {
    const user = useUserStore.getState();
    let token = "";
    let refreshes = 0;
    context.mock.method(useUserStore, "getState", () => ({ ...user, token, hydrateUser: async () => { refreshes++; } }));
    for (const protocol of ["openai", "gemini", "minimax", "mimo"] as const) {
        const config = { ...configFor("fixture", protocol), baseUrl: "https://wrong.invalid", apiKey: "wrong-key", activeChannelId: "channel" };
        const auth = protocol === "gemini" ? { "x-goog-api-key": "test-key" } : { Authorization: "Bearer test-key" };
        assert.deepEqual(aiHeaders(config), auth);
        assert.deepEqual(aiHeaders(config, "application/json"), { ...auth, "Content-Type": "application/json" });
        assert.equal(aiApiUrl(config, "/chat/completions"), "https://api.minimax.io/v1/chat/completions");
        refreshRemoteUser(config);
    }
    assert.equal(refreshes, 0);
    token = "account-token";
    const config = configFor("MiniMax-H3");
    for (const channelMode of ["local", "remote"] as const) {
        const scoped = { ...config, channelMode, publicChannels: config.localChannels };
        assert.deepEqual(aiHeaders(scoped), { Authorization: "Bearer account-token", [channelMode === "remote" ? "X-Model-Channel-ID" : "X-User-Model-Channel-ID"]: "channel" });
        assert.equal(aiApiUrl(scoped, "/videos"), "/api/v1/videos");
        refreshRemoteUser(scoped);
    }
    assert.equal(refreshes, 2);
    token = "";
    assert.throws(() => aiHeaders({ ...config, channelMode: "remote" }), /请先登录/);
});

test("personal and cloud video tasks preserve task identity and source while sharing normalized parameters", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "account-token" }));
    let expectedChannelHeader = "";
    context.mock.method(axios, "post", async (url: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
        assert.equal(url, "/api/v1/videos");
        assert.equal(options.headers[expectedChannelHeader], "channel");
        assert.equal(options.headers["X-Client-Video-Task-ID"], "client-id");
        assert.equal(options.headers["X-Video-Task-Source"], "canvas");
        assert.equal(options.headers["X-Video-Task-Source-ID"], "node-id");
        assert.equal(body.resolution, "768P");
        assert.equal(body.duration, 5);
        return { data: { code: 0, data: { id: "saved-id", task_id: "upstream-id", status: "queued" } } };
    });
    const config = { ...configFor("MiniMax-H3-Max"), vquality: "2K", videoSeconds: "4" };
    for (const channelMode of ["local", "remote"] as const) {
        expectedChannelHeader = channelMode === "remote" ? "X-Model-Channel-ID" : "X-User-Model-Channel-ID";
        const task = await createVideoGenerationTask({ ...config, channelMode, publicChannels: config.localChannels }, "scene", {}, undefined, { clientTaskId: "client-id", source: "canvas", sourceId: "node-id" });
        assert.equal(task.id, "saved-id");
        assert.equal(task.task_id, "upstream-id");
    }
    for (const status of ["failed", "error", "cancelled", "canceled"]) assert.ok(isFailedTask(status));
    assert.ok(isCompletedVideoTask({ id: "job", url: "https://media.example/video.mp4" }));
});

test("shared model rules and submitted video parameters agree", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    const fixtures = [
        { model: "sora-2", protocol: "openai", seconds: "7", want: "8" },
        { model: "veo-3.1", protocol: "openai", seconds: "4", want: "4" },
        { model: "veo-3.1", protocol: "gemini", seconds: "5", want: "4", resolution: "720" },
        { model: "veo-3.1", protocol: "gemini", seconds: "4", want: "8", resolution: "1080" },
        { model: "doubao-seedance-2.5", protocol: "openai", seconds: "40", want: "30" },
        { model: "doubao-seedance-2", protocol: "openai", seconds: "-1", want: "-1" },
        { model: "doubao-seedance-2.5", protocol: "ark", seconds: "40", want: "30" },
        { model: "cogvideox-3", protocol: "openai", seconds: "8", want: "10" },
        { model: "agnes-video-2.5", protocol: "openai", seconds: "30", want: "12" },
        { model: "minimax-hailuo-02", protocol: "openai", seconds: "8", want: "10" },
        { model: "wan2.6", protocol: "openai", seconds: "12", want: "10" },
        { model: "generic-video", protocol: "openai", seconds: "40", want: "30" },
    ] as const;
    let expectedSeconds = "";
    context.mock.method(axios, "post", async (url: string, body: FormData | Record<string, unknown>, options: { headers: Record<string, string> }) => {
        if (body instanceof FormData) assert.equal(options.headers["Content-Type"], undefined);
        else if (body.instances) {
            assert.match(url, /\/v1beta\/models\/veo-3\.1:predictLongRunning$/);
            assert.equal(options.headers["x-goog-api-key"], "test-key");
            assert.equal(body.model, undefined);
        }
        const parameters = body instanceof FormData ? null : body.parameters as Record<string, unknown> | undefined;
        const duration = body instanceof FormData ? body.get("seconds") : parameters?.durationSeconds ?? body.duration ?? body.seconds;
        assert.equal(String(duration), expectedSeconds);
        return { data: { id: "job", name: "operations/job", status: "queued" } };
    });
    for (const fixture of fixtures) {
        const config = { ...configFor(fixture.model, fixture.protocol), videoSeconds: fixture.seconds, vquality: "resolution" in fixture ? fixture.resolution : "720" };
        const normalized = normalizeVideoConfig(config, "text");
        expectedSeconds = fixture.want;
        assert.equal(normalized.videoSeconds, fixture.want, fixture.model);
        assert.equal(validateVideoDuration(config, Number(fixture.want), "text"), "");
        assert.deepEqual(normalizeVideoConfig(normalized, "text"), normalized);
        await createVideoGenerationTask(config, "scene");
    }
    assert.equal(videoDurationRule(configFor("veo-3.1", "gemini"), "reference").values?.[0], 8);
    assert.match(validateVideoDuration(configFor("MiniMax-H3-Max"), 4), /5–15/);
    assert.match(validateVideoDuration(configFor("generic-video", "openai"), 4.5), /整数/);
});

test("image parsers preserve batches, JSON and SSE results without local log requests", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
    context.after(() => { if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); });
    let payload: unknown;
    let stream = "";
    context.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
        assert.ok(!String(url).includes("ai-logs"));
        return stream ? new Response(stream, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(payload);
    });
    const config = { ...configFor("gpt-image-2", "openai"), count: "2", streamImages: false, codexCli: false, apiMode: "images" as const };
    payload = { data: [{ url: "https://media.example/one.png" }, { b64_json: "dHdv" }] };
    const images = await requestGeneration(config, "scene");
    assert.equal(images.length, 2);
    assert.equal(images[1].dataUrl, "data:image/png;base64,dHdv");
    payload = { output: [{ type: "image_generation_call", result: "aW1hZ2U=" }] };
    assert.equal((await requestGeneration({ ...config, count: "1", apiMode: "responses" }, "scene"))[0].dataUrl, "data:image/png;base64,aW1hZ2U=");
    stream = 'data: {"object":"image.generation.result","data":[{"url":"https://media.example/final.png"}]}\n\n';
    assert.equal((await requestGeneration({ ...config, count: "1", streamImages: true }, "scene"))[0].dataUrl, "https://media.example/final.png");
    stream = "";
    payload = { data: [] };
    await assert.rejects(requestGeneration(config, "scene"), (error: unknown) => error instanceof ImageRequestError && Boolean(error.detail?.includes('"data"')));
    payload = { choices: [{ message: { content: "answer" } }] };
    assert.equal(await requestImageQuestion(config, [{ role: "user", content: "question" }], () => {}), "answer");
});

test("audio and Agent use selected channel credentials and reject cloud requests without login", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    const config = { ...configFor("tts-1", "openai"), audioModel: "tts-1", audioChannelId: "channel", baseUrl: "", apiKey: "" };
    context.mock.method(axios, "post", async (url: string, _body: unknown, options: { headers: Record<string, string> }) => {
        assert.equal(url, "https://api.minimax.io/v1/audio/speech");
        assert.equal(options.headers.Authorization, "Bearer test-key");
        assert.equal(options.headers["Content-Type"], "application/json");
        return { data: new Blob(["audio"], { type: "audio/mpeg" }) };
    });
    assert.equal((await requestAudioGeneration(config, "hello")).type, "audio/mpeg");
    await assert.rejects(requestAudioGeneration({ ...config, channelMode: "remote" }, "hello"), /请先登录/);
    context.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
        assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-key");
        return Response.json({ choices: [{ message: { content: "answer" } }] });
    });
    const agentConfig = { ...configFor("gpt-4.1", "openai"), textModel: "gpt-4.1", textChannelId: "channel" };
    const turn = await requestCanvasAgentTurn({ config: agentConfig, systemPrompt: "help", messages: [{ role: "user", content: "hello" }], tools: [], toolMode: "native" });
    assert.equal(turn.content, "answer");
});

test("MiniMax prompt optimization and 2K regeneration use official task endpoints", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "" }));
    context.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network I/O"); });
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    context.mock.method(axios, "post", async (url: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
        assert.equal(options.headers.Authorization, "Bearer test-key");
        posts.push({ url, body });
        return { data: { task_id: "job" } };
    });
    let payload: unknown;
    context.mock.method(axios, "get", async (url: string) => {
        assert.equal(url, "https://api.minimax.io/v2/query/video_generation/job");
        return { data: payload };
    });
    const frame = { id: "frame", name: "frame.png", type: "image/png", dataUrl: "https://media.example/frame.png" };
    payload = { task: { id: "job", status: "succeeded", task_type: "h3_context_ir", modality: "text", content: { prompt: "enhanced scene" } } };
    assert.equal(await optimizeMiniMaxPrompt(configFor("MiniMax-H3"), "scene"), "enhanced scene");
    assert.deepEqual(posts.at(-1), { url: "https://api.minimax.io/v2/h3_context_ir", body: { model: "MiniMax-H3", content: [{ type: "text", text: "scene" }], duration: 5, ratio: "16:9" } });
    await optimizeMiniMaxPrompt(configFor("MiniMax-H3"), "scene", { firstFrame: frame });
    assert.deepEqual(posts.at(-1)?.body, { model: "MiniMax-H3", content: [{ type: "text", text: "scene" }, { type: "image_url", image_url: { url: frame.dataUrl }, role: "first_frame" }], duration: 5, ratio: "adaptive" });
    payload = { task: { id: "job", status: "failed", error: { code: "1026", message: "rejected" } } };
    await assert.rejects(optimizeMiniMaxPrompt(configFor("MiniMax-H3"), "scene"), /rejected/);
    await assert.rejects(optimizeMiniMaxPrompt(configFor("MiniMax-H3-Max"), "scene"), /MiniMax-H3/);
    const baseVideo = { id: "base", name: "base.mp4", type: "video/mp4", url: "https://media.example/base.mp4" };
    await createVideoGenerationTask({ ...configFor("MiniMax-H3"), vquality: "2K", videoWatermark: "true" }, "scene", { firstFrame: frame, baseVideo });
    assert.deepEqual(posts.at(-1), {
        url: "https://api.minimax.io/v2/video_regeneration",
        body: { model: "MiniMax-H3", resolution: "2K", aigc_watermark: true, content: [{ type: "text", text: "scene" }, { type: "image_url", image_url: { url: frame.dataUrl }, role: "first_frame" }, { type: "video_url", video_url: { url: baseVideo.url }, role: "base_video" }] },
    });
    const count = posts.length;
    await assert.rejects(createVideoGenerationTask(configFor("MiniMax-H3"), "scene", { baseVideo: { ...baseVideo, url: "data:video/mp4;base64,AA" } }), /同步到云端/);
    await assert.rejects(createVideoGenerationTask(configFor("MiniMax-H3-Max"), "scene", { baseVideo }), /MiniMax-H3/);
    await assert.rejects(createVideoGenerationTask(configFor("MiniMax-H3", "openai"), "scene", { baseVideo }), /MiniMax-H3/);
    assert.equal(posts.length, count);
});

test("account proxy sends internal MiniMax task models and polls Context-IR upstream", async (context) => {
    const user = useUserStore.getState();
    context.mock.method(useUserStore, "getState", () => ({ ...user, token: "account-token" }));
    const models: unknown[] = [];
    context.mock.method(axios, "post", async (url: string, body: Record<string, unknown>) => {
        assert.equal(url, "/api/v1/videos");
        models.push(body.model);
        return { data: { code: 0, data: { id: "job", task_id: "job", status: "queued" } } };
    });
    context.mock.method(axios, "get", async (url: string, options: { params?: Record<string, string> }) => {
        assert.equal(url, "/api/v1/videos/job");
        assert.deepEqual(options.params, { model: "MiniMax-H3" });
        return { data: { task: { id: "job", status: "succeeded", content: { prompt: "enhanced" } } } };
    });
    const config = configFor("MiniMax-H3");
    assert.equal(await optimizeMiniMaxPrompt(config, "scene"), "enhanced");
    await createVideoGenerationTask(config, "scene", { baseVideo: { id: "base", name: "base.mp4", type: "video/mp4", url: "https://media.example/base.mp4" } });
    assert.deepEqual(models, ["MiniMax-H3-Context-IR", "MiniMax-H3-Regenerate-2K"]);
});

test("MiniMax task queries follow the official ten-second interval", () => {
    const now = Date.now();
    const miniMax = configFor("MiniMax-H3");
    assert.equal(isVideoPollDue(miniMax, "MiniMax-H3", undefined, now), true);
    assert.equal(isVideoPollDue(miniMax, "MiniMax-H3", now - 5000, now), false);
    assert.equal(isVideoPollDue(miniMax, "MiniMax-H3", now - 8000, now), true);
    assert.equal(isVideoPollDue(configFor("generic-video", "openai"), "generic-video", now - 1000, now), true);
});
