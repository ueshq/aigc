import assert from "node:assert/strict";
import test from "node:test";
import { isRunningHubConfig, normalizeRunningHubVoice, runningHubModels, runningHubVideoCapabilities, runningHubVideoInputError } from "./runninghub";
import { normalizeVideoConfig, supportsVideoAudioGeneration, supportsVideoFrameReferences, videoDurationRule, videoParameterOptions } from "./video-model-capabilities";
import { defaultConfig, modelMatchesCapability } from "../stores/use-config-store";

const channel = { id: "runninghub", name: "RunningHub", protocol: "runninghub" as const, baseUrl: "https://www.runninghub.ai/openapi/v2", apiKey: "test", models: runningHubModels };
const configFor = (model: string, patch: Partial<typeof defaultConfig> = {}) => ({ ...defaultConfig, channelMode: "local" as const, model, videoModel: model, videoChannelId: channel.id, localChannels: [channel], ...patch });
const empty = { references: [], videoReferences: [], audioReferences: [], firstFrame: null, lastFrame: null };
const image = { id: "image" };

test("family names are classified by their capability suffix", () => {
    assert.ok(modelMatchesCapability("kling-v3.0-pro/video", "video"));
    assert.ok(modelMatchesCapability("alibaba/wan-2.7/image", "image"));
    assert.ok(modelMatchesCapability("minimax/speech-2.6-hd/tts", "audio"));
    assert.ok(!modelMatchesCapability("minimax/speech-2.6-hd/tts", "video"));
    assert.ok(!modelMatchesCapability("kling-v3.0-pro/video", "text"));
    assert.ok(modelMatchesCapability("minimax/music-cover/music", "audio"));
    assert.ok(!modelMatchesCapability("minimax/music-cover/music", "video"));
});

test("video options follow the endpoints serving each reference mode", () => {
    const config = configFor("kling-v3.0-pro/video", { size: "4:3", vquality: "1080", videoSeconds: "30" });
    assert.ok(isRunningHubConfig(config));
    assert.ok(!isRunningHubConfig({ ...config, localChannels: [{ ...channel, protocol: "openai" as const }] }));
    const text = normalizeVideoConfig(config, "text");
    assert.equal(text.size, "16:9");
    assert.equal(text.videoSeconds, "15");
    assert.deepEqual(videoParameterOptions(text, "text"), { resolutions: [], ratios: ["1:1", "16:9", "9:16"] });
    assert.deepEqual(videoDurationRule(text, "text"), { min: 3, max: 15, defaultSeconds: 5 });
    assert.equal(normalizeVideoConfig(config, "frames").size, "adaptive");
    assert.ok(supportsVideoFrameReferences("kling-v3.0-pro/video", "runninghub"));
    assert.ok(supportsVideoAudioGeneration("kling-v3.0-pro/video"));

    const sora = normalizeVideoConfig(configFor("rhart-video-s-official/pro/video", { size: "16:9", vquality: "4k" }), "text");
    assert.equal(sora.vquality, "720");
    assert.deepEqual(videoDurationRule(sora, "text").values, [4, 8, 12, 16, 20]);
    assert.ok(!supportsVideoFrameReferences("rhart-video-v3.1-lite/video"));
    assert.equal(runningHubVideoCapabilities("rhart-video-v3.1-lite/video", "frames").images, 3);
});

test("input validation mirrors backend endpoint selection", () => {
    assert.equal(runningHubVideoInputError("kling-v3.0-pro/video", { ...empty, firstFrame: image, lastFrame: image }), "");
    assert.equal(runningHubVideoInputError("kling-v3.0-pro/video", { ...empty, lastFrame: image }), "尾帧需要搭配首帧");
    assert.equal(runningHubVideoInputError("kling-v3.0-pro/video", { ...empty, references: [image] }), "该模型不支持参考素材");
    assert.equal(runningHubVideoInputError("kling-v3-turbo-pro/video", { ...empty, firstFrame: image, lastFrame: image }), "该模型不支持尾帧");
    assert.equal(runningHubVideoInputError("kling-v3.0-pro/video", { ...empty, firstFrame: image, audioReferences: [image] }), "该模型使用首尾帧时不支持参考音频");
    assert.equal(runningHubVideoInputError("rhart-video-v3.1-lite/video", { ...empty, firstFrame: image }), "");
    assert.equal(runningHubVideoInputError("rhart-video-v3.1-lite/video", { ...empty, references: [image, image, image, image] }), "该模型最多支持 3 个参考图片");
    assert.equal(runningHubVideoInputError("higgsfield/dop/video", empty), "该模型需要首帧");
    assert.equal(runningHubVideoInputError("rhart-video/video-upscaler/video", empty), "该模型需要参考视频");
    assert.equal(runningHubVideoInputError("rhart-video/video-upscaler/video", { ...empty, videoReferences: [image] }), "");
    assert.equal(runningHubVideoInputError("kling-v2.6-std/motion-control/video", { ...empty, videoReferences: [image] }), "该模型需要首帧");
});

test("TTS voices stay valid for the selected model", () => {
    assert.equal(normalizeRunningHubVoice("minimax/speech-2.6-hd/tts", "alloy"), "Wise_Woman");
    assert.equal(normalizeRunningHubVoice("minimax/speech-2.6-hd/tts", " Calm_Woman "), "Calm_Woman");
    assert.equal(normalizeRunningHubVoice("qwen3-tts-flash/tts", "Serena"), "Serena");
    assert.equal(normalizeRunningHubVoice("qwen3-tts-flash/tts", "unknown"), "Cherry");
});
